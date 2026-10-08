import { periodeKpiDe } from "@missionpilot/engines";
import { PERSPECTIVES_KPI } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  ciblesDe,
  definitionsDeMission,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  type CibleKpi,
  type DefinitionKpi,
} from "./donnees.js";
import {
  cibleDePeriode,
  evaluerSerieKpi,
  nombrePeriodesEvaluees,
  scoreDe,
  type KpiEvalue,
} from "./evaluation.js";
import { COLONNES_MESURE, versMesure, vueMesure, type LigneMesure } from "./mesures.js";
import {
  vueAlerte,
  vueCible,
  vueDefinition,
  vuePeriode,
  vueScore,
  vueSerie,
  vueTendance,
} from "./vues.js";

/*
 * Tableau de bord exécutif (KPI-03) et export des données (futur rapport
 * KPI-05) d'une mission : chaque statut, taux, écart, tendance, projection,
 * score et alerte sort du moteur (kpi/evaluation.ts).
 *
 * Volume borné (déni de service) : la date d'arrêté est bornée par le schéma
 * partagé ; la somme des périodes évaluées d'une requête est plafonnée AVANT
 * tout calcul (400 KPI_TROP_DE_PERIODES) ; l'export ne sert que les
 * PERIODES_EXPORTEES_MAX dernières périodes de chaque KPI et, pour ces
 * périodes, au plus MESURES_EXPORTEES_MAX lignes de mesure (les plus récentes).
 */

/** Somme maximale des périodes évaluées par requête (tous KPI de la mission confondus). */
export const MAX_PERIODES_EVALUEES_PAR_REQUETE = 20_000;
/** Périodes exportées par KPI : les plus récentes jusqu'à la date d'arrêté. */
export const PERIODES_EXPORTEES_MAX = 36;
/** Lignes de mesure exportées par KPI (actives, corrigées, annulées), les plus récentes. */
export const MESURES_EXPORTEES_MAX = 2_000;

/** Cible applicable à la période qui contient `date`. */
export function cibleActuelle(def: DefinitionKpi, cibles: readonly CibleKpi[], date: string) {
  return cibleDePeriode(cibles, periodeKpiDe(date, def.frequence).debut);
}

/** Refuse (400) une évaluation qui parcourrait trop de périodes, avant de lire les mesures. */
function exigerVolumeEvaluable(defs: readonly DefinitionKpi[], date: string): void {
  let total = 0;
  for (const def of defs) {
    total += nombrePeriodesEvaluees(def, date);
    if (total > MAX_PERIODES_EVALUEES_PAR_REQUETE) {
      throw new AppError(
        400,
        "KPI_TROP_DE_PERIODES",
        `L'évaluation dépasserait ${MAX_PERIODES_EVALUEES_PAR_REQUETE} périodes : choisissez une date d'arrêté plus proche du début du suivi ou réduisez le nombre de KPI suivis.`,
      );
    }
  }
}

async function evaluerMission(db: Db, missionId: string, date: string) {
  const defs = await definitionsDeMission(db, missionId, true);
  exigerVolumeEvaluable(defs, date);
  const params = await lireParametresKpi(db);
  const ids = defs.map((d) => d.id);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  const evalues: KpiEvalue[] = defs.map((def) => ({
    def,
    evaluation: evaluerSerieKpi(
      def,
      mesures.get(def.id) ?? [],
      cibles.get(def.id) ?? [],
      date,
      params,
    ),
  }));
  return { evalues, cibles };
}

/** Tableau de bord de la mission à la date d'arrêté : KPI actifs, scores, alertes. */
export async function tableauDeBord(db: Db, missionId: string, date: string) {
  const { evalues, cibles } = await evaluerMission(db, missionId, date);
  const groupes = [...PERSPECTIVES_KPI, null].map((perspective) => {
    const groupe = evalues.filter((k) => k.def.perspective === perspective);
    return { perspective, nombre_kpi: groupe.length, score: vueScore(scoreDe(groupe)) };
  });
  return {
    mission_id: missionId,
    date_reference: date,
    score_global: vueScore(scoreDe(evalues)),
    perspectives: groupes.filter((g) => g.nombre_kpi > 0),
    kpis: evalues.map((k) => ({
      ...vueDefinition(k.def, cibleActuelle(k.def, cibles.get(k.def.id) ?? [], date)),
      ...vueSerie(k.evaluation),
    })),
    alertes: evalues.flatMap((k) =>
      k.evaluation.alertes.map((a) => ({
        kpi_id: k.def.id,
        libelle: k.def.libelle,
        ...vueAlerte(a),
      })),
    ),
  };
}

interface FenetreExport {
  kpi_id: string;
  du: string;
  au: string;
}

/**
 * Historique des mesures (actives, corrigées, annulées) datées dans la fenêtre
 * exportée de chaque KPI, au plus MESURES_EXPORTEES_MAX + 1 lignes par KPI (la
 * ligne de plus signale la troncature), triées par KPI et numéro de saisie.
 */
async function historiqueMesures(db: Db, fenetres: readonly FenetreExport[]) {
  if (fenetres.length === 0) return [];
  const r = await db.query(
    `SELECT ${COLONNES_MESURE}, u.nom AS saisie_par_nom
     FROM (SELECT m.*, row_number() OVER (PARTITION BY m.kpi_id ORDER BY m.numero DESC) AS rang
           FROM kpi_mesures m
           JOIN unnest($1::uuid[], $2::date[], $3::date[]) AS f (kpi_id, du, au)
             ON f.kpi_id = m.kpi_id AND m.date_mesure BETWEEN f.du AND f.au) m
     LEFT JOIN utilisateurs u ON u.id = m.saisie_par
     WHERE m.rang <= $4
     ORDER BY m.kpi_id, m.numero`,
    [
      fenetres.map((f) => f.kpi_id),
      fenetres.map((f) => f.du),
      fenetres.map((f) => f.au),
      MESURES_EXPORTEES_MAX + 1,
    ],
  );
  return r.rows.map(versMesure);
}

/** Mesures exportées d'un KPI (au plus MESURES_EXPORTEES_MAX, les plus récentes) et troncature. */
function mesuresExportees(lignes: readonly LigneMesure[]) {
  const tronquees = lignes.length > MESURES_EXPORTEES_MAX;
  return { lignes: tronquees ? lignes.slice(1) : lignes, tronquees };
}

/**
 * Séries par période des KPI actifs d'une mission (graphique d'évolution du tableau de bord) :
 * lecture seule, sans l'historique des mesures de l'export, donc plus légère ; les
 * PERIODES_EXPORTEES_MAX dernières périodes de chaque KPI, calculées par le moteur.
 */
export async function serieKpiMission(db: Db, missionId: string, date: string) {
  const { evalues, cibles } = await evaluerMission(db, missionId, date);
  return {
    mission_id: missionId,
    date_reference: date,
    periodes_max: PERIODES_EXPORTEES_MAX,
    kpis: evalues.map((k) => ({
      definition: vueDefinition(k.def, cibleActuelle(k.def, cibles.get(k.def.id) ?? [], date)),
      statut: k.evaluation.statut,
      periodes_total: k.evaluation.periodes.length,
      periodes: k.evaluation.periodes.slice(-PERIODES_EXPORTEES_MAX).map(vuePeriode),
    })),
  };
}

/** Export structuré des KPI actifs d'une mission (format versionné, pour un rapport). */
export async function exporterKpiMission(db: Db, missionId: string, date: string) {
  const { evalues, cibles } = await evaluerMission(db, missionId, date);
  const mission = await db.query("SELECT id, intitule FROM missions WHERE id = $1", [missionId]);
  const exportees = evalues.map((k) => ({
    k,
    periodes: k.evaluation.periodes.slice(-PERIODES_EXPORTEES_MAX),
  }));
  const fenetres = exportees.flatMap(({ k, periodes }) => {
    const premiere = periodes[0];
    const derniere = periodes[periodes.length - 1];
    return premiere && derniere ? [{ kpi_id: k.def.id, du: premiere.debut, au: derniere.fin }] : [];
  });
  const mesures = parKpi(await historiqueMesures(db, fenetres));
  return {
    format: "missionpilot.kpi.v1",
    genere_le: new Date().toISOString(),
    date_reference: date,
    periodes_exportees_max: PERIODES_EXPORTEES_MAX,
    mesures_exportees_max: MESURES_EXPORTEES_MAX,
    mission: { id: missionId, intitule: (mission.rows[0]?.intitule as string | undefined) ?? null },
    score_global: vueScore(scoreDe(evalues)),
    kpis: exportees.map(({ k, periodes }) => {
      const m = mesuresExportees(mesures.get(k.def.id) ?? []);
      return {
        definition: vueDefinition(k.def, cibleActuelle(k.def, cibles.get(k.def.id) ?? [], date)),
        cibles: (cibles.get(k.def.id) ?? []).map(vueCible),
        mesures: m.lignes.map((l) => vueMesure(l, k.def.frequence)),
        mesures_tronquees: m.tronquees,
        statut: k.evaluation.statut,
        tendance: vueTendance(k.evaluation.tendance),
        periodes_total: k.evaluation.periodes.length,
        periodes: periodes.map(vuePeriode),
        alertes: k.evaluation.alertes.map(vueAlerte),
      };
    }),
  };
}
