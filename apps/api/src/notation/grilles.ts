import { exigerGrilleValide, type GrilleNotation } from "@missionpilot/engines";
import {
  GRILLE_GENERIQUE,
  type GrilleNotationCreation,
  type GrilleNotationDonnees,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { paginer } from "../http/outils.js";
import { exigerExpertMetier } from "../questionnaires/acces.js";

/*
 * Grilles de notation du cabinet (NOT-01) : copie de la grille générique de
 * MissionPilot (ou d'une grille du cabinet, ou contenu saisi), versions en
 * brouillon puis validées par un détenteur de « notation.publier » et figées
 * (migration 0145). Le contenu est contrôlé par le moteur
 * (`exigerGrilleValide`) ; son identifiant et sa version sont posés par le
 * serveur. La grille générique sert directement quand aucune grille n'est
 * choisie au calcul.
 */

/** Contenu normalisé (code et version du serveur) et validé par le moteur. */
export function normaliserGrille(
  contenu: GrilleNotationDonnees | GrilleNotation,
  code: string,
  version: number,
): GrilleNotation {
  const grille = { ...contenu, id: code, version } as GrilleNotation;
  exigerGrilleValide(grille);
  return grille;
}

interface VersionGrille {
  id: string;
  grille_id: string;
  version: number;
  statut: "brouillon" | "valide";
  contenu: GrilleNotation;
}

const COLONNES_VERSION = `v.id, v.grille_id, v.version, v.statut, v.cree_le, v.modifie_le,
  v.valide_le, v.cree_par, v.modifie_par, v.valide_par`;

async function derniereVersion(db: Db, grilleId: string): Promise<VersionGrille | undefined> {
  const r = await db.query(
    `SELECT id, grille_id, version, statut, contenu FROM notation_grille_versions
     WHERE grille_id = $1 ORDER BY version DESC LIMIT 1`,
    [grilleId],
  );
  return r.rows[0] as VersionGrille | undefined;
}

async function contenuSource(db: Db, source: GrilleNotationCreation["source"]) {
  if (source.type === "generique") return { contenu: GRILLE_GENERIQUE, origine: "generique" };
  if (source.type === "contenu") return { contenu: source.contenu, origine: "cabinet" };
  const v = await derniereVersion(db, source.grille_id);
  if (!v) throw introuvable("Grille de notation");
  return { contenu: v.contenu, origine: "copie" };
}

export async function creerGrille(db: Db, auth: Auth, corps: GrilleNotationCreation) {
  const { contenu, origine } = await contenuSource(db, corps.source);
  const grille = normaliserGrille(
    corps.titre ? { ...contenu, titre: corps.titre } : contenu,
    corps.code,
    1,
  );
  const g = await traduireErreursPg(
    db.query(
      `INSERT INTO notation_grilles (cabinet_id, code, titre, origine, copie_de, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        corps.code,
        grille.titre,
        origine,
        corps.source.type === "copie" ? corps.source.grille_id : null,
        auth.utilisateurId,
      ],
    ),
    { "*": "Une grille de notation porte déjà ce code." },
  );
  const grilleId = g.rows[0].id as string;
  const v = await db.query(
    `INSERT INTO notation_grille_versions (cabinet_id, grille_id, version, contenu, cree_par, modifie_par)
     VALUES ($1, $2, 1, $3, $4, $4) RETURNING id`,
    [auth.cabinetId, grilleId, JSON.stringify(grille), auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "notation_grille",
    entiteId: grilleId,
    details: { code: corps.code, origine, version_id: v.rows[0].id },
  });
  return lireGrille(db, grilleId);
}

export async function listerGrilles(db: Db, apres: [string, string] | null, limite: number) {
  const r = await db.query(
    `SELECT g.id, g.code, g.titre, g.origine, g.cree_le, g.modifie_le,
       (SELECT v.id FROM notation_grille_versions v WHERE v.grille_id = g.id AND v.statut = 'valide'
        ORDER BY v.version DESC LIMIT 1) AS version_validee_id,
       EXISTS (SELECT 1 FROM notation_grille_versions v WHERE v.grille_id = g.id
               AND v.statut = 'brouillon') AS brouillon,
       lower(g.titre) AS cle_tri
     FROM notation_grilles g
     WHERE ($1::text IS NULL OR (lower(g.titre), g.id) > ($1, $2::uuid))
     ORDER BY lower(g.titre), g.id LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], limite);
}

export async function lireGrille(db: Db, id: string) {
  const g = await db.query(
    `SELECT id, code, titre, origine, copie_de, cree_par, cree_le, modifie_le
     FROM notation_grilles WHERE id = $1`,
    [id],
  );
  if (!g.rows[0]) throw introuvable("Grille de notation");
  const v = await db.query(
    `SELECT ${COLONNES_VERSION} FROM notation_grille_versions v WHERE v.grille_id = $1
     ORDER BY v.version DESC`,
    [id],
  );
  return { ...g.rows[0], versions: v.rows };
}

export async function lireVersionGrille(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION}, v.contenu, g.code FROM notation_grille_versions v
     JOIN notation_grilles g ON g.id = v.grille_id WHERE v.id = $1
     ${verrouiller ? "FOR UPDATE OF v" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Version de grille");
  return r.rows[0] as VersionGrille & { code: string; cree_par: string; modifie_par: string };
}

export async function creerVersionGrille(
  db: Db,
  auth: Auth,
  grilleId: string,
  contenu: GrilleNotationDonnees | undefined,
) {
  const g = await db.query("SELECT id, code FROM notation_grilles WHERE id = $1 FOR UPDATE", [
    grilleId,
  ]);
  if (!g.rows[0]) throw introuvable("Grille de notation");
  const derniere = await derniereVersion(db, grilleId);
  if (derniere?.statut === "brouillon") {
    throw conflit("Un brouillon existe déjà pour cette grille : modifiez-le ou faites-le valider.");
  }
  const numero = (derniere?.version ?? 0) + 1;
  const source = contenu ?? derniere?.contenu;
  if (!source) throw introuvable("Grille de notation");
  const grille = normaliserGrille(source, g.rows[0].code as string, numero);
  const v = await db.query(
    `INSERT INTO notation_grille_versions (cabinet_id, grille_id, version, contenu, cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [auth.cabinetId, grilleId, numero, JSON.stringify(grille), auth.utilisateurId],
  );
  await db.query("UPDATE notation_grilles SET titre = $2, modifie_le = now() WHERE id = $1", [
    grilleId,
    grille.titre,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation_version",
    entite: "notation_grille",
    entiteId: grilleId,
    details: { version: numero, version_id: v.rows[0].id },
  });
  return lireVersionGrille(db, v.rows[0].id as string);
}

export async function modifierVersionGrille(
  db: Db,
  auth: Auth,
  id: string,
  contenu: GrilleNotationDonnees,
) {
  const v = await lireVersionGrille(db, id, true);
  if (v.statut !== "brouillon") {
    throw conflit(
      "Cette version de grille est validée : elle est figée, créez une nouvelle version.",
    );
  }
  const grille = normaliserGrille(contenu, v.code, v.version);
  await db.query(
    "UPDATE notation_grille_versions SET contenu = $2, modifie_par = $3 WHERE id = $1",
    [id, JSON.stringify(grille), auth.utilisateurId],
  );
  await db.query("UPDATE notation_grilles SET titre = $2, modifie_le = now() WHERE id = $1", [
    v.grille_id,
    grille.titre,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification_version",
    entite: "notation_grille",
    entiteId: v.grille_id,
    details: { version: v.version, version_id: id },
  });
  return lireVersionGrille(db, id);
}

/**
 * Validation (« notation.publier », contrôlée par la route) par un expert
 * métier qui n'est ni l'auteur ni le dernier modificateur du brouillon
 * (séparation des tâches) ; doublée par le déclencheur de 0145 (MPN04).
 */
export async function validerVersionGrille(db: Db, auth: Auth, id: string) {
  exigerExpertMetier(auth, "valide une version de grille");
  const v = await lireVersionGrille(db, id, true);
  if (v.statut !== "brouillon") throw conflit("Cette version de grille est déjà validée.");
  if (auth.utilisateurId === v.cree_par || auth.utilisateurId === v.modifie_par) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "L'auteur ou le dernier modificateur d'une version de grille ne la valide pas : un autre expert doit la relire.",
    );
  }
  exigerGrilleValide(v.contenu);
  await db.query(
    `UPDATE notation_grille_versions SET statut = 'valide', valide_par = $2, valide_le = now(),
       modifie_par = $2 WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation_version",
    entite: "notation_grille",
    entiteId: v.grille_id,
    details: { version: v.version, version_id: id },
  });
  return lireVersionGrille(db, id);
}
