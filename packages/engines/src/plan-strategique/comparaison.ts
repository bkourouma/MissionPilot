/**
 * Comparaison de deux versions du modèle financier d'un plan (PLA-09).
 *
 * Les deux résultats comparés sont ceux, figés, du moteur (`calculerScenariosPlan`) :
 * rien n'est recalculé. Le moteur aligne les exercices par millésime et calcule pour
 * chaque valeur l'écart exact « arrivée − départ » et l'écart relatif à la valeur de
 * départ (fraction arrondie à 4 décimales, `null` si la valeur de départ est nulle ou
 * pour un taux, dont l'écart se lit directement en points).
 */
import { differenceExacte, ratio, versRationnel } from "../finance/calcul-exact";
import { versEntier } from "./exact";
import type { ExercicePrevisionnel } from "./modele";
import type { NomScenario, ResultatScenarios, SyntheseScenario } from "./scenarios";

export type NatureValeurComparee = "montant" | "taux" | "nombre";

export interface SerieCleePlan {
  readonly cle: string;
  readonly libelle: string;
  readonly extraire: (a: ExercicePrevisionnel) => number;
}

/** Séries clés du scénario de base, par exercice (montants). */
export const SERIES_CLES_PLAN: readonly SerieCleePlan[] = [
  {
    cle: "chiffre_affaires",
    libelle: "Chiffre d'affaires",
    extraire: (a) => a.compteResultat.chiffreAffaires,
  },
  {
    cle: "excedent_brut_exploitation",
    libelle: "Excédent brut d'exploitation",
    extraire: (a) => a.compteResultat.excedentBrutExploitation,
  },
  { cle: "resultat_net", libelle: "Résultat net", extraire: (a) => a.compteResultat.resultatNet },
  {
    cle: "capacite_autofinancement",
    libelle: "Capacité d'autofinancement",
    extraire: (a) => a.indicateurs.capaciteAutofinancement,
  },
  {
    cle: "tresorerie_nette",
    libelle: "Trésorerie nette de clôture",
    extraire: (a) => a.bilan.tresorerieNette,
  },
  {
    cle: "flux_libre",
    libelle: "Flux de trésorerie disponible",
    extraire: (a) => a.indicateurs.fluxLibre,
  },
  {
    cle: "endettement_net",
    libelle: "Endettement net",
    extraire: (a) => a.indicateurs.endettementNet,
  },
];

interface IndicateurSynthese {
  readonly cle: string;
  readonly libelle: string;
  readonly nature: NatureValeurComparee;
  readonly extraire: (s: SyntheseScenario) => number | null;
}

const INDICATEURS_SYNTHESE: readonly IndicateurSynthese[] = [
  {
    cle: "chiffre_affaires_final",
    libelle: "Chiffre d'affaires final",
    nature: "montant",
    extraire: (s) => s.chiffreAffairesFinal,
  },
  {
    cle: "resultat_net_cumule",
    libelle: "Résultat net cumulé",
    nature: "montant",
    extraire: (s) => s.resultatNetCumule,
  },
  {
    cle: "tresorerie_finale",
    libelle: "Trésorerie finale",
    nature: "montant",
    extraire: (s) => s.tresorerieFinale,
  },
  {
    cle: "valeur_actuelle_nette",
    libelle: "Valeur actuelle nette",
    nature: "montant",
    extraire: (s) => s.valeurActuelleNette,
  },
  {
    cle: "taux_rendement_interne",
    libelle: "Taux de rendement interne",
    nature: "taux",
    extraire: (s) => s.tauxRendementInterne,
  },
  {
    cle: "nombre_alertes",
    libelle: "Alertes de vraisemblance",
    nature: "nombre",
    extraire: (s) => s.nombreAlertes,
  },
];

export interface EcartValeurs {
  readonly de: number | null;
  readonly a: number | null;
  /** a − de, exact ; null si l'une des deux valeurs manque. */
  readonly ecart: number | null;
  /** (a − de) / |de| à 4 décimales ; null si de est nul ou absent, ou pour un taux. */
  readonly ecartRelatif: number | null;
}

export interface PointCompare extends EcartValeurs {
  readonly exercice: number;
}

export interface SerieComparee {
  readonly cle: string;
  readonly libelle: string;
  readonly points: readonly PointCompare[];
}

export interface IndicateurCompare extends EcartValeurs {
  readonly cle: string;
  readonly libelle: string;
  readonly nature: NatureValeurComparee;
}

export interface SyntheseComparee {
  readonly scenario: NomScenario;
  readonly indicateurs: readonly IndicateurCompare[];
}

export interface ComparaisonResultatsPlan {
  /** Séries clés du scénario de base, exercices alignés par millésime. */
  readonly series: readonly SerieComparee[];
  /** Indicateurs de synthèse de chaque scénario. */
  readonly synthese: readonly SyntheseComparee[];
}

/** Écart exact entre deux valeurs (entiers d'unités mineures, ou décimaux). */
export function ecartValeurs(
  de: number | null,
  a: number | null,
  nature: NatureValeurComparee = "montant",
): EcartValeurs {
  if (de === null || a === null) return { de, a, ecart: null, ecartRelatif: null };
  const ecart =
    Number.isInteger(de) && Number.isInteger(a)
      ? versEntier(BigInt(a) - BigInt(de))
      : differenceExacte(a, de);
  const rde = versRationnel(de);
  const ecartRelatif =
    nature === "taux"
      ? null
      : ratio(versRationnel(ecart), { num: rde.num < 0n ? -rde.num : rde.num, den: rde.den });
  return { de, a, ecart, ecartRelatif };
}

function comparerSerie(
  de: ResultatScenarios,
  a: ResultatScenarios,
  serie: SerieCleePlan,
): SerieComparee {
  const valeursDe = new Map(de.base.annees.map((x) => [x.exercice, serie.extraire(x)]));
  const valeursA = new Map(a.base.annees.map((x) => [x.exercice, serie.extraire(x)]));
  const exercices = [...new Set([...valeursDe.keys(), ...valeursA.keys()])].sort((x, y) => x - y);
  return {
    cle: serie.cle,
    libelle: serie.libelle,
    points: exercices.map((exercice) => ({
      exercice,
      ...ecartValeurs(valeursDe.get(exercice) ?? null, valeursA.get(exercice) ?? null),
    })),
  };
}

function comparerSynthese(
  de: ResultatScenarios,
  a: ResultatScenarios,
  scenario: NomScenario,
): SyntheseComparee {
  const sDe = de.synthese.find((s) => s.scenario === scenario);
  const sA = a.synthese.find((s) => s.scenario === scenario);
  return {
    scenario,
    indicateurs: INDICATEURS_SYNTHESE.map((i) => ({
      cle: i.cle,
      libelle: i.libelle,
      nature: i.nature,
      ...ecartValeurs(sDe ? i.extraire(sDe) : null, sA ? i.extraire(sA) : null, i.nature),
    })),
  };
}

/** Compare deux résultats figés du moteur (version de départ `de`, version d'arrivée `a`). */
export function comparerResultatsPlan(
  de: ResultatScenarios,
  a: ResultatScenarios,
): ComparaisonResultatsPlan {
  return {
    series: SERIES_CLES_PLAN.map((s) => comparerSerie(de, a, s)),
    synthese: (["base", "optimiste", "pessimiste"] as const).map((s) => comparerSynthese(de, a, s)),
  };
}
