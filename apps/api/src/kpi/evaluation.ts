import {
  agregerKpiParPeriode,
  ajouterJours,
  alerteDegradationKpi,
  alerteRetardKpi,
  alertesSeuilsKpi,
  evaluerKpi,
  periodeKpiDe,
  projeterKpiFinPeriode,
  scoreCompositeKpi,
  tendanceKpi,
  type AlerteKpi,
  type EvaluationKpi,
  type MesureKpi,
  type ProjectionKpi,
  type ScoreCompositeKpi,
  type SeuilsStatutKpi,
  type StatutKpi,
  type TendanceKpi,
} from "@missionpilot/engines";
import type { CibleKpi, DefinitionKpi, MesureActive, ParametresKpi } from "./donnees.js";

/*
 * Évaluation d'un KPI à une date d'arrêté, ENTIÈREMENT par le moteur
 * (packages/engines/src/kpi) : agrégation par période (flux = somme, stock =
 * dernière valeur), atteinte, écart et statut (seuils 0,95 / 0,80 par défaut
 * ou ceux du KPI), tendance, projection, alertes (dégradation après N
 * variations défavorables, retard de mesure avec délai de grâce, seuils
 * KPI-04) et score composite. Ce module ne fait que choisir les entrées :
 * - période close : sa fin précède la date d'arrêté (ou le suivi est fini) ;
 *   statut, tendance, dégradation et seuils portent sur les périodes closes ;
 * - période en cours : réalisé partiel et projection à sa fin ;
 * - cible d'une période : version de plus grand (a_partir_de, version) dont
 *   a_partir_de ne dépasse pas le début de la période (sélection, pas calcul).
 */

export interface PeriodeEvaluee {
  cle: string;
  debut: string;
  fin: string;
  close: boolean;
  valeur: number | null;
  nombre_mesures: number;
  cible: number | null;
  evaluation: EvaluationKpi;
}

export interface AlerteDatee {
  alerte: AlerteKpi;
  /** Période concernée : clé d'idempotence des alertes et des rappels. */
  periode_cle: string;
}

export interface EvaluationSerieKpi {
  date_reference: string;
  periodes: PeriodeEvaluee[];
  /** Dernière période close mesurée (base du statut du KPI), ou null. */
  derniere: PeriodeEvaluee | null;
  statut: StatutKpi;
  tendance: TendanceKpi;
  en_cours: {
    periode: PeriodeEvaluee;
    projection: ProjectionKpi;
    statut_projete: StatutKpi;
  } | null;
  alertes: AlerteDatee[];
}

/** Seuils de statut propres au KPI, sinon ceux du moteur (KPI-03). */
export function seuilsDe(def: DefinitionKpi): SeuilsStatutKpi | undefined {
  return def.seuil_vert === null || def.seuil_orange === null
    ? undefined
    : { vert: def.seuil_vert, orange: def.seuil_orange };
}

/** Cible applicable à une période commençant le `debut` (cibles triées par a_partir_de, version). */
export function cibleDePeriode(cibles: readonly CibleKpi[], debut: string): number | null {
  let retenue: CibleKpi | null = null;
  for (const c of cibles) if (c.a_partir_de <= debut) retenue = c;
  return retenue?.valeur ?? null;
}

/** Fin de l'intervalle évalué : la date d'arrêté, bornée par la fin de suivi. */
function finEvaluee(def: DefinitionKpi, dateReference: string): string {
  return def.fin_suivi !== null && def.fin_suivi < dateReference ? def.fin_suivi : dateReference;
}

/**
 * Nombre de périodes que l'évaluation à `dateReference` parcourt (écart des rangs
 * de période du moteur), sans les énumérer : sert à borner une requête AVANT tout calcul.
 */
export function nombrePeriodesEvaluees(def: DefinitionKpi, dateReference: string): number {
  const au = finEvaluee(def, dateReference);
  if (au < def.debut_suivi) return 0;
  return (
    periodeKpiDe(au, def.frequence).rang - periodeKpiDe(def.debut_suivi, def.frequence).rang + 1
  );
}

function serieEvaluee(
  def: DefinitionKpi,
  mesures: readonly MesureKpi[],
  cibles: readonly CibleKpi[],
  dateReference: string,
): PeriodeEvaluee[] {
  const au = finEvaluee(def, dateReference);
  if (au < def.debut_suivi) return [];
  const suiviTermine = def.fin_suivi !== null && def.fin_suivi < dateReference;
  const seuils = seuilsDe(def);
  return agregerKpiParPeriode(mesures, {
    frequence: def.frequence,
    nature: def.nature,
    du: def.debut_suivi,
    au,
  }).map((p) => {
    const cible = cibleDePeriode(cibles, p.periode.debut);
    return {
      cle: p.periode.cle,
      debut: p.periode.debut,
      fin: p.periode.fin,
      close: suiviTermine || p.periode.fin < dateReference,
      valeur: p.valeur,
      nombre_mesures: p.nombreMesures,
      cible,
      evaluation: evaluerKpi({ valeur: p.valeur, cible, sens: def.sens }, { seuils }),
    };
  });
}

/** Index de la dernière période mesurée, ou -1. */
function indexDerniereMesuree(periodes: readonly PeriodeEvaluee[]): number {
  for (let i = periodes.length - 1; i >= 0; i--) if (periodes[i]?.valeur !== null) return i;
  return -1;
}

/** Date d'arrêté du contrôle de retard : bornée après la dernière période suivie. */
function referenceRetard(def: DefinitionKpi, dateReference: string, delai: number): string {
  if (def.fin_suivi === null) return dateReference;
  const borne = ajouterJours(periodeKpiDe(def.fin_suivi, def.frequence).fin, delai + 1);
  return borne < dateReference ? borne : dateReference;
}

function alertesDe(
  def: DefinitionKpi,
  closes: readonly PeriodeEvaluee[],
  datesMesures: readonly string[],
  dateReference: string,
  params: ParametresKpi,
): AlerteDatee[] {
  const alertes: AlerteDatee[] = [];
  const derniereClose = closes[closes.length - 1];
  const degradation = alerteDegradationKpi(
    closes.map((p) => p.valeur),
    def.sens,
    { periodes: params.periodes_degradation },
  );
  if (degradation && derniereClose) {
    alertes.push({ alerte: degradation, periode_cle: derniereClose.cle });
  }
  const indexDerniere = indexDerniereMesuree(closes);
  const derniere = closes[indexDerniere];
  if (derniere) {
    const precedente = closes[indexDerniere - 1]?.valeur ?? null;
    const seuils = alertesSeuilsKpi(derniere.valeur, precedente, {
      haut: def.alerte_haut,
      bas: def.alerte_bas,
      variationMax: def.alerte_variation,
    });
    for (const alerte of seuils) alertes.push({ alerte, periode_cle: derniere.cle });
  }
  if (def.actif) {
    const retard = alerteRetardKpi({
      frequence: def.frequence,
      datesMesures,
      dateReference: referenceRetard(def, dateReference, params.delai_grace_jours),
      suiviDepuis: def.debut_suivi,
      delaiGraceJours: params.delai_grace_jours,
    });
    if (retard?.code === "MESURE_EN_RETARD") {
      alertes.push({ alerte: retard, periode_cle: retard.dernierePeriodeDue });
    }
  }
  return alertes;
}

/** Évaluation complète d'un KPI à la date d'arrêté (mesures actives, cibles versionnées). */
export function evaluerSerieKpi(
  def: DefinitionKpi,
  mesuresActives: readonly MesureActive[],
  cibles: readonly CibleKpi[],
  dateReference: string,
  params: ParametresKpi,
): EvaluationSerieKpi {
  const mesures: MesureKpi[] = mesuresActives
    .filter((m) => m.date <= dateReference)
    .map((m) => ({ date: m.date, valeur: m.valeur }));
  const periodes = serieEvaluee(def, mesures, cibles, dateReference);
  const closes = periodes.filter((p) => p.close);
  const derniere = closes[indexDerniereMesuree(closes)] ?? null;
  const courante = periodes.find((p) => !p.close) ?? null;
  let en_cours: EvaluationSerieKpi["en_cours"] = null;
  if (courante) {
    const projection = projeterKpiFinPeriode(mesures, {
      nature: def.nature,
      debut: courante.debut,
      fin: courante.fin,
      dateReference,
    });
    const statut_projete = evaluerKpi(
      { valeur: projection.valeurProjetee, cible: courante.cible, sens: def.sens },
      { seuils: seuilsDe(def) },
    ).statut;
    en_cours = { periode: courante, projection, statut_projete };
  }
  return {
    date_reference: dateReference,
    periodes,
    derniere,
    statut: derniere ? derniere.evaluation.statut : "non_mesure",
    tendance: tendanceKpi(
      closes.map((p) => p.valeur),
      def.sens,
    ),
    en_cours,
    alertes: alertesDe(
      def,
      closes,
      mesures.map((m) => m.date),
      dateReference,
      params,
    ),
  };
}

export interface KpiEvalue {
  def: DefinitionKpi;
  evaluation: EvaluationSerieKpi;
}

/**
 * Score composite pondéré (moteur) des KPI donnés, sur leur dernière période
 * close mesurée ; null s'il n'y a aucun KPI de poids non nul.
 */
export function scoreDe(kpis: readonly KpiEvalue[]): ScoreCompositeKpi | null {
  if (!kpis.some((k) => k.def.ponderation > 0)) return null;
  return scoreCompositeKpi(
    kpis.map((k) => ({
      code: k.def.id,
      poids: k.def.ponderation,
      valeur: k.evaluation.derniere?.valeur ?? null,
      cible: k.evaluation.derniere?.cible ?? null,
      sens: k.def.sens,
    })),
  );
}
