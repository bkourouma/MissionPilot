import type { Db } from "../db/pool.js";
import { COLONNES_ACTION, type LigneAction } from "./actions.js";
import { limiteLecturePilotage, plafonnerLecture } from "./pilotage-donnees.js";

/*
 * Lectures et projections des revues de performance (KPI-17, migration 0441), partagées par
 * kpi/revues.ts (écritures) et kpi/dossier-revue.ts (rendu) sans dépendance circulaire.
 */

export interface LigneRevue {
  id: string;
  mission_id: string;
  numero: number;
  titre: string;
  date_prevue: string;
  date_reference: string;
  statut: "planifiee" | "tenue" | "cloturee" | "annulee";
  animateur_id: string | null;
  animateur_nom: string | null;
  ordre_du_jour: PointOrdreDuJour[];
  compte_rendu: string | null;
  tenue_le: Date | null;
  cloturee_le: Date | null;
  dossier_fige: boolean;
  cree_le: Date;
  modifie_le: Date;
}

export interface PointOrdreDuJour {
  rang: number;
  code: string;
  libelle: string;
  kpi_id: string | null;
  action_id: string | null;
  decision_id: string | null;
  priorite: number;
  duree_minutes: number;
  origine: "moteur" | "manuel";
}

export interface LigneDecision {
  id: string;
  revue_id: string;
  numero: number;
  libelle: string;
  kpi_id: string | null;
  responsable_id: string | null;
  responsable_nom: string | null;
  echeance: string | null;
  statut: "ouverte" | "en_cours" | "executee" | "abandonnee";
  motif: string | null;
  cloturee_le: Date | null;
  cree_le: Date;
}

export const COLONNES_REVUE = `r.id, r.mission_id, r.numero, r.titre, r.date_prevue::text AS date_prevue,
  r.date_reference::text AS date_reference, r.statut, r.animateur_id, an.nom AS animateur_nom,
  r.ordre_du_jour, r.compte_rendu, r.tenue_le, r.cloturee_le, (r.dossier IS NOT NULL) AS dossier_fige,
  r.cree_le, r.modifie_le`;
export const JOINTURES_REVUE =
  "FROM kpi_revues r LEFT JOIN utilisateurs an ON an.id = r.animateur_id";

export const COLONNES_DECISION = `d.id, d.revue_id, d.numero, d.libelle, d.kpi_id, d.responsable_id,
  u.nom AS responsable_nom, d.echeance::text AS echeance, d.statut, d.motif, d.cloturee_le, d.cree_le`;
export const JOINTURES_DECISION =
  "FROM kpi_revue_decisions d LEFT JOIN utilisateurs u ON u.id = d.responsable_id";

export async function lireRevue(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<LigneRevue | null> {
  const r = await db.query(
    `SELECT ${COLONNES_REVUE} ${JOINTURES_REVUE} WHERE r.id = $1 ${verrouiller ? "FOR UPDATE OF r" : ""}`,
    [id],
  );
  return (r.rows[0] as LigneRevue | undefined) ?? null;
}

export const vueRevue = (r: LigneRevue) => ({
  id: r.id,
  mission_id: r.mission_id,
  numero: r.numero,
  titre: r.titre,
  date_prevue: r.date_prevue,
  date_reference: r.date_reference,
  statut: r.statut,
  animateur_id: r.animateur_id,
  animateur_nom: r.animateur_nom,
  ordre_du_jour: r.ordre_du_jour,
  compte_rendu: r.compte_rendu,
  tenue_le: r.tenue_le,
  cloturee_le: r.cloturee_le,
  dossier_fige: r.dossier_fige,
  cree_le: r.cree_le,
  modifie_le: r.modifie_le,
});

export const vueDecision = (d: LigneDecision) => ({
  id: d.id,
  revue_id: d.revue_id,
  numero: d.numero,
  libelle: d.libelle,
  kpi_id: d.kpi_id,
  responsable_id: d.responsable_id,
  responsable_nom: d.responsable_nom,
  echeance: d.echeance,
  statut: d.statut,
  motif: d.motif,
  cloturee_le: d.cloturee_le,
  cree_le: d.cree_le,
});

/** Décisions d'une revue (au plus MAX_LIGNES_PILOTAGE ; `tronque` si la liste est plus longue). */
export async function decisionsDeRevue(db: Db, revueId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_DECISION} ${JOINTURES_DECISION} WHERE d.revue_id = $1
     ORDER BY d.numero LIMIT $2`,
    [revueId, limiteLecturePilotage()],
  );
  return plafonnerLecture(r.rows as LigneDecision[]);
}

/** Actions d'une revue (au plus MAX_LIGNES_PILOTAGE ; `tronque` si la liste est plus longue). */
export async function actionsDeRevue(db: Db, revueId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_ACTION} FROM kpi_actions a
     JOIN kpi_definitions k ON k.id = a.kpi_id LEFT JOIN utilisateurs u ON u.id = a.responsable_id
     WHERE a.revue_id = $1 ORDER BY a.numero LIMIT $2`,
    [revueId, limiteLecturePilotage()],
  );
  return plafonnerLecture(r.rows as LigneAction[]);
}
