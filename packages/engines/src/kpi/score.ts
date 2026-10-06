/**
 * Score composite pondéré de plusieurs KPI (tableau de bord exécutif, KPI-03).
 *
 * Score = Σ poids × taux d'atteinte borné / Σ poids, sur les seuls KPI
 * mesurés et dotés d'une cible : les autres sont exclus du calcul, et
 * signalés avec leur raison (« non_mesure », « sans_cible »). Les poids sont
 * normalisés sur les KPI retenus ; `couverture` donne la part du poids total
 * effectivement mesurée, pour que l'appelant sache sur quoi repose le score.
 *
 * Bornes par défaut du taux retenu : [0 ; 1]. Un KPI très en avance ne
 * compense donc pas un KPI en échec, et un KPI très en retard ne pèse pas
 * plus que son poids. Le statut du score suit les mêmes seuils que les KPI.
 * Calcul exact ; sorties arrondies à 4 décimales.
 */
import { ErreurKpi } from "./erreurs";
import {
  bornesExactes,
  construireAtteinte,
  seuilsExacts,
  statutExact,
  type OptionsAtteinteKpi,
  type SensLectureKpi,
  type SeuilsStatutKpi,
  type StatutKpi,
  type StatutKpiMesure,
} from "./atteinte";
import {
  ZERO,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  multiplier,
  somme,
  versTexte,
  type Fraction,
} from "./fraction";

export interface KpiPondere {
  readonly code: string;
  readonly poids: number;
  readonly valeur: number | null | undefined;
  readonly cible: number | null | undefined;
  readonly sens: SensLectureKpi;
}

export interface OptionsScoreKpi extends OptionsAtteinteKpi {
  readonly seuils?: SeuilsStatutKpi;
}

export const BORNES_SCORE_KPI_DEFAUT = { plancher: 0, plafond: 1 } as const;

export interface ContributionKpi {
  readonly code: string;
  /** Poids normalisé sur les KPI retenus (somme 1), 4 décimales. */
  readonly poidsNormalise: number;
  /** Taux d'atteinte borné retenu, 4 décimales. */
  readonly taux: number;
  /** poidsNormalise × taux, 4 décimales. */
  readonly contribution: number;
  readonly statut: StatutKpiMesure;
}

export interface KpiExclu {
  readonly code: string;
  readonly raison: "non_mesure" | "sans_cible";
}

export interface ScoreCompositeKpi {
  /** Score en fraction (0,9 = 90 %), 4 décimales ; `null` sans KPI retenu de poids non nul. */
  readonly score: number | null;
  readonly scoreExact: string | null;
  readonly statut: StatutKpi;
  readonly contributions: readonly ContributionKpi[];
  readonly exclus: readonly KpiExclu[];
  /** Poids retenu / poids total, 4 décimales. */
  readonly couverture: number;
}

interface Retenu {
  readonly code: string;
  readonly poids: Fraction;
  readonly taux: Fraction;
  readonly statut: StatutKpiMesure;
}

function lirePoids(kpis: readonly KpiPondere[]): Fraction[] {
  const codes = new Set<string>();
  const poids = kpis.map((k) => {
    if (codes.has(k.code)) {
      throw new ErreurKpi("KPI_EN_DOUBLE", `Le KPI « ${k.code} » figure deux fois.`);
    }
    codes.add(k.code);
    const p = depuisNombre(k.poids, `Le poids du KPI « ${k.code} »`);
    if (comparer(p, ZERO) < 0) {
      throw new ErreurKpi("PONDERATION_INVALIDE", `Le poids du KPI « ${k.code} » est négatif.`);
    }
    return p;
  });
  if (estNul(somme(poids))) {
    throw new ErreurKpi(
      "PONDERATION_INVALIDE",
      "La somme des poids doit être strictement positive.",
    );
  }
  return poids;
}

function contributions(retenus: readonly Retenu[], total: Fraction): ContributionKpi[] {
  return retenus.map((r) => {
    const normalise = estNul(total) ? ZERO : diviser(r.poids, total);
    return {
      code: r.code,
      poidsNormalise: arrondir(normalise),
      taux: arrondir(r.taux),
      contribution: arrondir(multiplier(normalise, r.taux)),
      statut: r.statut,
    };
  });
}

/** Score composite pondéré ; KPI non mesurés ou sans cible exclus et signalés. */
export function scoreCompositeKpi(
  kpis: readonly KpiPondere[],
  options: OptionsScoreKpi = {},
): ScoreCompositeKpi {
  const seuils = seuilsExacts(options.seuils);
  const bornes = bornesExactes({
    plancher: options.plancher === undefined ? BORNES_SCORE_KPI_DEFAUT.plancher : options.plancher,
    plafond: options.plafond === undefined ? BORNES_SCORE_KPI_DEFAUT.plafond : options.plafond,
  });
  const poids = lirePoids(kpis);
  const retenus: Retenu[] = [];
  const exclus: KpiExclu[] = [];
  kpis.forEach((k, i) => {
    if (k.valeur == null || k.cible == null) {
      exclus.push({ code: k.code, raison: k.valeur == null ? "non_mesure" : "sans_cible" });
      return;
    }
    const v = depuisNombre(k.valeur, `La valeur du KPI « ${k.code} »`);
    const c = depuisNombre(k.cible, `La cible du KPI « ${k.code} »`);
    const { brut, borne } = construireAtteinte(v, c, k.sens, bornes);
    const statut = statutExact(brut, seuils);
    retenus.push({ code: k.code, poids: poids[i] as Fraction, taux: borne, statut });
  });
  const totalRetenu = somme(retenus.map((r) => r.poids));
  const couverture = arrondir(diviser(totalRetenu, somme(poids)));
  const parts = contributions(retenus, totalRetenu);
  if (estNul(totalRetenu)) {
    return {
      score: null,
      scoreExact: null,
      statut: "non_mesure",
      contributions: parts,
      exclus,
      couverture,
    };
  }
  const score = diviser(somme(retenus.map((r) => multiplier(r.poids, r.taux))), totalRetenu);
  return {
    score: arrondir(score),
    scoreExact: versTexte(score),
    statut: statutExact(score, seuils),
    contributions: parts,
    exclus,
    couverture,
  };
}
