import { periodeKpiDe } from "@missionpilot/engines";
import type { FrequenceKpiApi } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { decimal } from "./donnees.js";

/*
 * Mesures d'un KPI (KPI-02), historique EN AJOUT SEUL (migration 0160) :
 * - saisie : nouvelle ligne datée ;
 * - correction : nouvelle ligne qui remplace une mesure active (motif) ;
 * - annulation : ligne sans valeur qui remplace une mesure active (motif).
 * Les contrôles (KPI actif, période de suivi, unicité de la mesure active
 * d'une date, remplacement unique, chaîne de corrections bornée) sont des
 * déclencheurs SQL ; l'appelant a verrouillé le KPI (FOR UPDATE) pour
 * sérialiser les saisies.
 */

/**
 * Corrections successives d'une même mesure (chaîne de remplacements), doublé en
 * base (0160, MPK07) ; une annulation reste ensuite possible, la date se ressaisit.
 */
export const MAX_CORRECTIONS_PAR_MESURE = 20;

export interface NouvelleMesure {
  cabinetId: string;
  kpiId: string;
  dateMesure: string;
  /** null : annulation. */
  valeur: number | null;
  remplaceId: string | null;
  motif: string | null;
  commentaire: string | null;
  justificatif: string | null;
  origine: "cabinet" | "portail";
  saisiePar: string;
}

export interface LigneMesure {
  id: string;
  kpi_id: string;
  numero: string;
  date_mesure: string;
  valeur: number | null;
  annulation: boolean;
  remplace_id: string | null;
  remplacee: boolean;
  motif: string | null;
  commentaire: string | null;
  justificatif: string | null;
  origine: "cabinet" | "portail";
  saisie_par: string;
  saisie_par_nom: string | null;
  saisie_le: Date;
}

export const COLONNES_MESURE = `m.id, m.kpi_id, m.numero::text AS numero,
  m.date_mesure::text AS date_mesure, m.valeur::text AS valeur, m.annulation, m.remplace_id,
  EXISTS (SELECT 1 FROM kpi_mesures r WHERE r.remplace_id = m.id) AS remplacee,
  m.motif, m.commentaire, m.justificatif, m.origine, m.saisie_par, m.saisie_le`;

export function versMesure(l: Record<string, unknown>): LigneMesure {
  return {
    id: l.id as string,
    kpi_id: l.kpi_id as string,
    numero: l.numero as string,
    date_mesure: l.date_mesure as string,
    valeur: decimal(l.valeur),
    annulation: l.annulation as boolean,
    remplace_id: (l.remplace_id as string | null) ?? null,
    remplacee: l.remplacee === true,
    motif: (l.motif as string | null) ?? null,
    commentaire: (l.commentaire as string | null) ?? null,
    justificatif: (l.justificatif as string | null) ?? null,
    origine: l.origine as "cabinet" | "portail",
    saisie_par: l.saisie_par as string,
    saisie_par_nom: (l.saisie_par_nom as string | null | undefined) ?? null,
    saisie_le: l.saisie_le as Date,
  };
}

export async function insererMesure(db: Db, m: NouvelleMesure): Promise<LigneMesure> {
  const r = await db.query(
    `INSERT INTO kpi_mesures (cabinet_id, kpi_id, date_mesure, valeur, annulation, remplace_id,
       motif, commentaire, justificatif, origine, saisie_par)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      m.cabinetId,
      m.kpiId,
      m.dateMesure,
      m.valeur === null ? null : String(m.valeur),
      m.valeur === null,
      m.remplaceId,
      m.motif,
      m.commentaire,
      m.justificatif,
      m.origine,
      m.saisiePar,
    ],
  );
  const lue = await lireMesure(db, r.rows[0].id as string);
  if (!lue) throw new Error("Mesure introuvable après insertion.");
  return lue;
}

/** Une mesure (filtrée par RLS), avec le nom de son auteur. */
export async function lireMesure(db: Db, id: string): Promise<LigneMesure | null> {
  const r = await db.query(
    `SELECT ${COLONNES_MESURE}, u.nom AS saisie_par_nom
     FROM kpi_mesures m LEFT JOIN utilisateurs u ON u.id = m.saisie_par WHERE m.id = $1`,
    [id],
  );
  return r.rows[0] ? versMesure(r.rows[0]) : null;
}

/** Vue interne d'une mesure : période (moteur), état actif, auteur. */
export function vueMesure(m: LigneMesure, frequence: FrequenceKpiApi) {
  return {
    id: m.id,
    kpi_id: m.kpi_id,
    date_mesure: m.date_mesure,
    periode: periodeKpiDe(m.date_mesure, frequence).cle,
    valeur: m.valeur,
    annulation: m.annulation,
    remplace_id: m.remplace_id,
    active: !m.annulation && !m.remplacee,
    motif: m.motif,
    commentaire: m.commentaire,
    justificatif: m.justificatif,
    origine: m.origine,
    saisie_par: { id: m.saisie_par, nom: m.saisie_par_nom },
    saisie_le: m.saisie_le,
  };
}

/**
 * Vue du portail : jamais l'identité d'un auteur, seulement « saisie par moi ».
 * Motif, commentaire et justificatif ne sont servis que pour une ligne saisie
 * DEPUIS le portail : ceux du cabinet (corrections, annulations) restent internes (null).
 */
export function vueMesurePortail(m: LigneMesure, frequence: FrequenceKpiApi, moi: string) {
  const duPortail = m.origine === "portail";
  return {
    id: m.id,
    date_mesure: m.date_mesure,
    periode: periodeKpiDe(m.date_mesure, frequence).cle,
    valeur: m.valeur,
    annulation: m.annulation,
    remplace_id: m.remplace_id,
    active: !m.annulation && !m.remplacee,
    motif: duPortail ? m.motif : null,
    commentaire: duPortail ? m.commentaire : null,
    justificatif: duPortail ? m.justificatif : null,
    origine: m.origine,
    saisie_par_moi: m.saisie_par === moi,
    saisie_le: m.saisie_le,
  };
}
