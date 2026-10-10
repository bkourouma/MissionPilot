import { z } from "zod";
import {
  SALLE_MODELES_MAX,
  sallePieceSchema,
  type SaisiePieceSalle,
  type salleModeleCreationSchema,
  type salleModeleModificationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";

/*
 * Modèles de demandes documentaires du cabinet (CLI-01) : nom, pièces attendues, méthode
 * facultative (standard ou du cabinet ; contrôlée par déclencheur, MPL04). Un modèle se modifie
 * ou s'archive (actif = faux), jamais ne se supprime ; une demande COPIE ses pièces à la
 * création : modifier le modèle ne change aucune demande existante.
 */

type CreationModele = z.infer<typeof salleModeleCreationSchema>;
type ModificationModele = z.infer<typeof salleModeleModificationSchema>;

const COLONNES = `m.id, m.nom, m.description, m.methode_id, m.pieces, m.actif, m.cree_le,
  m.modifie_le`;

export interface ModeleDb {
  id: string;
  nom: string;
  description: string | null;
  methode_id: string | null;
  pieces: SaisiePieceSalle[];
  actif: boolean;
  cree_le: Date;
  modifie_le: Date;
}

/** Pièces normalisées pour le stockage (obligatoire explicite, description nulle si vide). */
export function normaliserPieces(pieces: readonly SaisiePieceSalle[]) {
  return pieces.map((p) => ({
    libelle: p.libelle,
    description: p.description ?? null,
    obligatoire: p.obligatoire ?? true,
  }));
}

/** Pièces d'un modèle relues et revalidées (le JSON stocké n'est jamais cru tel quel). */
export function piecesDuModele(m: Pick<ModeleDb, "pieces">): SaisiePieceSalle[] {
  return z.array(sallePieceSchema).parse(m.pieces);
}

export async function listerModeles(
  db: Db,
  filtre: { methodeId?: string; archives: boolean },
): Promise<{ elements: ModeleDb[]; tronque: boolean }> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM salle_modeles m
     WHERE ($1::boolean OR m.actif) AND ($2::uuid IS NULL OR m.methode_id = $2
       OR m.methode_id IN (SELECT x.parent_id FROM methodes x WHERE x.id = $2))
     ORDER BY lower(m.nom), m.id LIMIT $3`,
    [filtre.archives, filtre.methodeId ?? null, SALLE_MODELES_MAX + 1],
  );
  return {
    elements: (r.rows as ModeleDb[]).slice(0, SALLE_MODELES_MAX),
    tronque: r.rows.length > SALLE_MODELES_MAX,
  };
}

export async function exigerModele(db: Db, id: string, verrouiller = false): Promise<ModeleDb> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM salle_modeles m WHERE m.id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Modèle");
  return r.rows[0] as ModeleDb;
}

export async function creerModele(db: Db, auth: Auth, corps: CreationModele): Promise<ModeleDb> {
  const nombre = await db.query("SELECT count(*)::int AS n FROM salle_modeles");
  if ((nombre.rows[0].n as number) >= SALLE_MODELES_MAX) {
    throw conflit(`Le cabinet a déjà ${SALLE_MODELES_MAX} modèles : archivez-en avant d'en créer.`);
  }
  const r = await db.query(
    `INSERT INTO salle_modeles (cabinet_id, nom, description, methode_id, pieces, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      auth.cabinetId,
      corps.nom,
      corps.description ?? null,
      corps.methode_id ?? null,
      JSON.stringify(normaliserPieces(corps.pieces)),
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_modele_creation",
    entite: "salle_modele",
    entiteId: id,
    details: { nom: corps.nom, pieces: corps.pieces.length, methode_id: corps.methode_id ?? null },
  });
  return exigerModele(db, id);
}

export async function modifierModele(
  db: Db,
  auth: Auth,
  id: string,
  corps: ModificationModele,
): Promise<ModeleDb> {
  await exigerModele(db, id, true);
  const modif: Record<string, unknown> = {
    nom: corps.nom,
    description: corps.description,
    methode_id: corps.methode_id,
    actif: corps.actif,
    pieces: corps.pieces ? normaliserPieces(corps.pieces) : undefined,
  };
  const set = clauseSet(modif, 2, ["pieces"]);
  await db.query(`UPDATE salle_modeles SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
    id,
    ...set.valeurs,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_modele_modification",
    entite: "salle_modele",
    entiteId: id,
    details: {
      champs: Object.keys(corps).filter((k) => (corps as Record<string, unknown>)[k] !== undefined),
    },
  });
  return exigerModele(db, id);
}
