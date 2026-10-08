import {
  FACTEURS_CABINET_MAX,
  type facteurCreationSchema,
  type noteContexteCreationSchema,
  type noteContexteQuerySchema,
  type TaxonomieCreation,
  type taxonomieQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { lireFacteurs } from "./modulation.js";

/*
 * Dictionnaire de données (STD-10), facteurs de contexte (STD-04), services
 * (STD-01) et notes de contexte (STD-06). Lecture : standard + cabinet
 * (`standard.lire`) ; ajout : lignes du cabinet seulement (`standard.gerer`),
 * jamais en écrasant un code du standard. Dictionnaire en ajout seul.
 */

const origine = (cabinetId: string | null) => (cabinetId === null ? "standard" : "cabinet");

export async function listerTaxonomies(db: Db, q: z.infer<typeof taxonomieQuerySchema>) {
  const curseur = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT t.id, t.cabinet_id, t.taxonomie, t.code, t.libelle, t.parent_code, t.description, t.ordre,
            (t.taxonomie || '|' || t.code) COLLATE "C" AS cle_tri
     FROM taxonomie_entrees t
     WHERE ($1::text IS NULL OR t.taxonomie = $1)
       AND ($2::text IS NULL OR ((t.taxonomie || '|' || t.code) COLLATE "C", t.id) > ($2 COLLATE "C", $3::uuid))
     ORDER BY (t.taxonomie || '|' || t.code) COLLATE "C", t.id
     LIMIT $4`,
    [q.taxonomie ?? null, curseur?.[0] ?? null, curseur?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows, q.limite);
  return {
    ...page,
    elements: page.elements.map(({ cabinet_id, ...t }) => ({ ...t, origine: origine(cabinet_id) })),
  };
}

export async function creerTaxonomie(db: Db, auth: Auth, corps: TaxonomieCreation) {
  const existe = await db.query(
    `SELECT 1 FROM taxonomie_entrees WHERE cabinet_id IS NULL AND taxonomie = $1 AND code = $2`,
    [corps.taxonomie, corps.code],
  );
  if (existe.rowCount) throw conflit("Ce code existe déjà dans le standard.");
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO taxonomie_entrees (cabinet_id, taxonomie, code, libelle, parent_code, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, taxonomie, code, libelle, parent_code, description, ordre`,
      [
        auth.cabinetId,
        corps.taxonomie,
        corps.code,
        corps.libelle,
        corps.parent_code ?? null,
        corps.description ?? null,
      ],
    ),
    { "*": "Ce code existe déjà dans cette taxonomie." },
  );
  const ligne = r.rows[0];
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.taxonomie.ajouter",
    entite: "taxonomie_entree",
    entiteId: ligne.id,
    details: { taxonomie: corps.taxonomie, code: corps.code },
  });
  return { ...ligne, origine: "cabinet" };
}

export async function listerFacteurs(db: Db) {
  const facteurs = await lireFacteurs(db);
  return {
    elements: facteurs.map(({ cabinet_id, min, max, ...f }) => ({
      ...f,
      min: min === null ? null : Number(min),
      max: max === null ? null : Number(max),
      origine: origine(cabinet_id),
    })),
  };
}

export async function creerFacteur(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof facteurCreationSchema>,
) {
  // Sérialise les ajouts du cabinet : la borne de 200 tient sous concurrence.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('facteurs_contexte'), hashtext($1))", [
    auth.cabinetId,
  ]);
  const r0 = await db.query(
    `SELECT (SELECT count(*) FROM facteurs_contexte WHERE cabinet_id = $1)::int AS nombre,
            EXISTS (SELECT 1 FROM facteurs_contexte WHERE cabinet_id IS NULL AND code = $2) AS standard`,
    [auth.cabinetId, corps.code],
  );
  if (r0.rows[0].standard) throw conflit("Ce code de facteur existe déjà dans le standard.");
  if (r0.rows[0].nombre >= FACTEURS_CABINET_MAX) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      `Facteurs du cabinet : ${FACTEURS_CABINET_MAX} au plus.`,
    );
  }
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO facteurs_contexte (cabinet_id, code, libelle, description, type, valeurs, min, max, porte_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        auth.cabinetId,
        corps.code,
        corps.libelle,
        corps.description ?? null,
        corps.type,
        corps.valeurs ? JSON.stringify(corps.valeurs) : null,
        corps.min ?? null,
        corps.max ?? null,
        corps.porte_par,
      ],
    ),
    { "*": "Ce code de facteur existe déjà." },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.facteur.ajouter",
    entite: "facteur_contexte",
    entiteId: r.rows[0].id,
    details: { code: corps.code, type: corps.type },
  });
  return (await listerFacteurs(db)).elements.find((f) => f.id === r.rows[0].id);
}

export async function listerServices(db: Db) {
  const r = await db.query(
    `SELECT id, cabinet_id, code, libelle, description, ordre FROM services_conseil
     ORDER BY cabinet_id NULLS FIRST, ordre, code`,
  );
  return {
    elements: r.rows.map(({ cabinet_id, ...s }) => ({ ...s, origine: origine(cabinet_id) })),
  };
}

export async function listerNotes(db: Db, q: z.infer<typeof noteContexteQuerySchema>) {
  const curseur = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT n.id, n.cabinet_id, n.cible_type, n.cible_code, n.contexte, n.texte, n.cree_le,
            u.nom AS auteur_nom, n.cree_le::text AS cle_tri
     FROM notes_contexte n LEFT JOIN utilisateurs u ON u.id = n.auteur_id
     WHERE ($1::text IS NULL OR n.cible_type = $1) AND ($2::text IS NULL OR n.cible_code = $2)
       AND ($3::timestamptz IS NULL OR (n.cree_le, n.id) > ($3::timestamptz, $4::uuid))
     ORDER BY n.cree_le, n.id
     LIMIT $5`,
    [
      q.cible_type ?? null,
      q.cible_code ?? null,
      curseur?.[0] ?? null,
      curseur?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const page = paginer(r.rows, q.limite);
  return {
    ...page,
    elements: page.elements.map(({ cabinet_id, ...n }) => ({ ...n, origine: origine(cabinet_id) })),
  };
}

export async function creerNote(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof noteContexteCreationSchema>,
) {
  const r = await db.query(
    `INSERT INTO notes_contexte (cabinet_id, cible_type, cible_code, contexte, texte, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, cible_type, cible_code, contexte, texte, cree_le`,
    [
      auth.cabinetId,
      corps.cible_type,
      corps.cible_code,
      corps.contexte ?? null,
      corps.texte,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.note.ajouter",
    entite: "note_contexte",
    entiteId: r.rows[0].id,
    details: { cible_type: corps.cible_type, cible_code: corps.cible_code },
  });
  return { ...r.rows[0], auteur_nom: auth.nom, origine: "cabinet" };
}
