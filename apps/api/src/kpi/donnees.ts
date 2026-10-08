import type {
  FrequenceKpiApi,
  NatureKpiApi,
  PerspectiveKpi,
  SensLectureKpiApi,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/*
 * Lecture des données du pilotage par KPI (migration 0160), dans la
 * transaction reçue (RLS du cabinet, et du client dans une transaction du
 * portail). Aucune agrégation SQL : les valeurs sont lues telles quelles et
 * remises au moteur (kpi/evaluation.ts). Les `numeric` sont lus en texte puis
 * convertis en `number` : l'écriture décimale saisie est conservée en base.
 */

export interface DefinitionKpi {
  id: string;
  mission_id: string;
  client_id: string;
  libelle: string;
  description: string | null;
  unite: string;
  perspective: PerspectiveKpi | null;
  sens: SensLectureKpiApi;
  nature: NatureKpiApi;
  frequence: FrequenceKpiApi;
  ponderation: number;
  seuil_vert: number | null;
  seuil_orange: number | null;
  alerte_haut: number | null;
  alerte_bas: number | null;
  alerte_variation: number | null;
  proprietaire_id: string | null;
  debut_suivi: string;
  fin_suivi: string | null;
  rappels_actifs: boolean;
  actif: boolean;
  cree_le: Date;
  modifie_le: Date;
}

export interface CibleKpi {
  kpi_id: string;
  version: number;
  valeur: number | null;
  a_partir_de: string;
  motif: string | null;
  cree_par: string;
  cree_le: Date;
}

export interface MesureActive {
  kpi_id: string;
  id: string;
  date: string;
  valeur: number;
}

export interface ParametresKpi {
  rappels_actifs: boolean;
  delai_grace_jours: number;
  periodes_degradation: number;
  valeurs_validees: boolean;
}

/** Valeurs de départ (à valider par le métier) : rappels actifs, 5 jours de grâce, 3 périodes. */
export const PARAMETRES_KPI_DEPART: ParametresKpi = {
  rappels_actifs: true,
  delai_grace_jours: 5,
  periodes_degradation: 3,
  valeurs_validees: false,
};

/** Nombre maximal de KPI par mission (liste servie en entier, sans pagination). */
export const MAX_KPI_PAR_MISSION = 200;

export const COLONNES_KPI = `d.id, d.mission_id, d.client_id, d.libelle, d.description, d.unite,
  d.perspective, d.sens, d.nature, d.frequence, d.ponderation::text AS ponderation,
  d.seuil_vert::text AS seuil_vert, d.seuil_orange::text AS seuil_orange,
  d.alerte_haut::text AS alerte_haut, d.alerte_bas::text AS alerte_bas,
  d.alerte_variation::text AS alerte_variation, d.proprietaire_id,
  d.debut_suivi::text AS debut_suivi, d.fin_suivi::text AS fin_suivi, d.rappels_actifs, d.actif,
  d.cree_le, d.modifie_le`;

/** `numeric` lu en texte → nombre, ou null. */
export function decimal(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function versDefinition(l: Record<string, unknown>): DefinitionKpi {
  return {
    id: l.id as string,
    mission_id: l.mission_id as string,
    client_id: l.client_id as string,
    libelle: l.libelle as string,
    description: (l.description as string | null) ?? null,
    unite: l.unite as string,
    perspective: (l.perspective as PerspectiveKpi | null) ?? null,
    sens: l.sens as SensLectureKpiApi,
    nature: l.nature as NatureKpiApi,
    frequence: l.frequence as FrequenceKpiApi,
    ponderation: Number(l.ponderation),
    seuil_vert: decimal(l.seuil_vert),
    seuil_orange: decimal(l.seuil_orange),
    alerte_haut: decimal(l.alerte_haut),
    alerte_bas: decimal(l.alerte_bas),
    alerte_variation: decimal(l.alerte_variation),
    proprietaire_id: (l.proprietaire_id as string | null) ?? null,
    debut_suivi: l.debut_suivi as string,
    fin_suivi: (l.fin_suivi as string | null) ?? null,
    rappels_actifs: l.rappels_actifs as boolean,
    actif: l.actif as boolean,
    cree_le: l.cree_le as Date,
    modifie_le: l.modifie_le as Date,
  };
}

/** Un KPI par identifiant (filtré par RLS), sans contrôle de visibilité. */
export async function lireDefinition(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<DefinitionKpi | null> {
  const r = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d WHERE d.id = $1 ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  return r.rows[0] ? versDefinition(r.rows[0]) : null;
}

/** KPI d'une mission (actifs seulement si demandé), triés par libellé. */
export async function definitionsDeMission(
  db: Db,
  missionId: string,
  actifsSeulement = false,
): Promise<DefinitionKpi[]> {
  const r = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d
     WHERE d.mission_id = $1 AND ($2::boolean = false OR d.actif)
     ORDER BY lower(d.libelle), d.id LIMIT $3`,
    [missionId, actifsSeulement, MAX_KPI_PAR_MISSION],
  );
  return r.rows.map(versDefinition);
}

/** Historique des cibles des KPI donnés, trié par (KPI, a_partir_de, version). */
export async function ciblesDe(db: Db, kpiIds: readonly string[]): Promise<CibleKpi[]> {
  if (kpiIds.length === 0) return [];
  const r = await db.query(
    `SELECT kpi_id, version, valeur::text AS valeur, a_partir_de::text AS a_partir_de, motif,
       cree_par, cree_le
     FROM kpi_cibles WHERE kpi_id = ANY ($1::uuid[]) ORDER BY kpi_id, a_partir_de, version`,
    [kpiIds],
  );
  return r.rows.map((l) => ({
    kpi_id: l.kpi_id as string,
    version: l.version as number,
    valeur: decimal(l.valeur),
    a_partir_de: l.a_partir_de as string,
    motif: (l.motif as string | null) ?? null,
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
  }));
}

/** Mesures ACTIVES (ni annulées, ni remplacées) des KPI donnés, triées par date. */
export async function mesuresActivesDe(db: Db, kpiIds: readonly string[]): Promise<MesureActive[]> {
  if (kpiIds.length === 0) return [];
  const r = await db.query(
    `SELECT m.kpi_id, m.id, m.date_mesure::text AS date, m.valeur::text AS valeur
     FROM kpi_mesures m
     WHERE m.kpi_id = ANY ($1::uuid[]) AND NOT m.annulation
       AND NOT EXISTS (SELECT 1 FROM kpi_mesures r WHERE r.remplace_id = m.id)
     ORDER BY m.kpi_id, m.date_mesure, m.numero`,
    [kpiIds],
  );
  return r.rows.map((l) => ({
    kpi_id: l.kpi_id as string,
    id: l.id as string,
    date: l.date as string,
    valeur: Number(l.valeur),
  }));
}

/** Regroupe des lignes par KPI. */
export function parKpi<T extends { kpi_id: string }>(lignes: readonly T[]): Map<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const l of lignes) {
    const g = groupes.get(l.kpi_id);
    if (g) g.push(l);
    else groupes.set(l.kpi_id, [l]);
  }
  return groupes;
}

export async function lireParametresKpi(db: Db): Promise<ParametresKpi> {
  const r = await db.query(
    `SELECT rappels_actifs, delai_grace_jours, periodes_degradation, valeurs_validees
     FROM kpi_parametres`,
  );
  return (r.rows[0] as ParametresKpi | undefined) ?? PARAMETRES_KPI_DEPART;
}
