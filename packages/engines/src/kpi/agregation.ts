/**
 * Agrégation d'une série de mesures par période (KPI-02, KPI-03).
 *
 * La nature du KPI fixe l'agrégation par défaut :
 * - flux (chiffre d'affaires, nombre de ventes) : somme des mesures de la période ;
 * - stock (effectif, trésorerie, encours) : dernière valeur de la période.
 * L'appelant peut imposer « somme », « moyenne » (taux, délais moyens) ou
 * « derniere ».
 *
 * La série rendue est contiguë et triée : chaque période de l'intervalle
 * figure, avec `valeur: null` si elle n'a aucune mesure (« non mesuré »).
 * Sans `du`/`au`, l'intervalle va de la première à la dernière période
 * mesurée ; avec, les mesures hors intervalle sont écartées.
 *
 * « Dernière valeur » : la mesure de date la plus récente. Deux mesures à la
 * même date rendraient le résultat dépendant de l'ordre de saisie : elles
 * sont refusées (`MESURES_AMBIGUES`) en mode « derniere ».
 */
import type { DateISO } from "../commun/dates";
import { ErreurKpi } from "./erreurs";
import {
  arrondir,
  depuisNombre,
  diviser,
  entier,
  somme,
  versTexte,
  type Fraction,
} from "./fraction";
import {
  jourKpi,
  periodesKpiParRang,
  rangKpiDuJour,
  type FrequenceKpi,
  type PeriodeKpi,
} from "./periodes";

export type NatureKpi = "flux" | "stock";
export type ModeAgregationKpi = "somme" | "moyenne" | "derniere";

export interface MesureKpi {
  readonly date: DateISO;
  readonly valeur: number;
}

export interface OptionsAgregationKpi {
  readonly frequence: FrequenceKpi;
  readonly nature: NatureKpi;
  /** Impose un mode ; défaut : somme pour un flux, dernière valeur pour un stock. */
  readonly agregation?: ModeAgregationKpi;
  /** Début de l'intervalle (fourni avec `au`). */
  readonly du?: DateISO;
  /** Fin de l'intervalle (fournie avec `du`). */
  readonly au?: DateISO;
}

export interface ValeurPeriodeKpi {
  readonly periode: PeriodeKpi;
  /** Valeur agrégée arrondie à 4 décimales ; `null` si la période n'a aucune mesure. */
  readonly valeur: number | null;
  readonly valeurExacte: string | null;
  readonly nombreMesures: number;
}

export function agregationKpiParDefaut(nature: NatureKpi): ModeAgregationKpi {
  return nature === "flux" ? "somme" : "derniere";
}

interface MesureLue {
  readonly jour: number;
  readonly rang: number;
  readonly valeur: Fraction;
}

function lireMesures(mesures: readonly MesureKpi[], frequence: FrequenceKpi): MesureLue[] {
  return mesures.map((m, i) => {
    const jour = jourKpi(m.date, `La date de la mesure ${i + 1}`);
    return {
      jour,
      rang: rangKpiDuJour(jour, frequence),
      valeur: depuisNombre(m.valeur, `La valeur de la mesure ${i + 1}`),
    };
  });
}

function refuserDatesEnDouble(lues: readonly MesureLue[]): void {
  const vus = new Set<number>();
  for (const m of lues) {
    if (vus.has(m.jour)) {
      throw new ErreurKpi(
        "MESURES_AMBIGUES",
        "Deux mesures portent la même date : la dernière valeur est ambiguë.",
      );
    }
    vus.add(m.jour);
  }
}

function agreger(mesures: readonly MesureLue[], mode: ModeAgregationKpi): Fraction {
  if (mode === "somme") return somme(mesures.map((m) => m.valeur));
  if (mode === "moyenne")
    return diviser(somme(mesures.map((m) => m.valeur)), entier(mesures.length));
  let derniere = mesures[0] as MesureLue;
  for (const m of mesures) if (m.jour > derniere.jour) derniere = m;
  return derniere.valeur;
}

function intervalle(
  lues: readonly MesureLue[],
  options: OptionsAgregationKpi,
): { readonly premier: number; readonly dernier: number } | null {
  if ((options.du === undefined) !== (options.au === undefined)) {
    throw new ErreurKpi("OPTIONS_INVALIDES", "« du » et « au » se fournissent ensemble.");
  }
  if (options.du !== undefined && options.au !== undefined) {
    return {
      premier: rangKpiDuJour(jourKpi(options.du, "Le début"), options.frequence),
      dernier: rangKpiDuJour(jourKpi(options.au, "La fin"), options.frequence),
    };
  }
  if (lues.length === 0) return null;
  let premier = (lues[0] as MesureLue).rang;
  let dernier = premier;
  for (const m of lues) {
    if (m.rang < premier) premier = m.rang;
    if (m.rang > dernier) dernier = m.rang;
  }
  return { premier, dernier };
}

/** Agrège les mesures par période, en série contiguë (périodes sans mesure à `null`). */
export function agregerKpiParPeriode(
  mesures: readonly MesureKpi[],
  options: OptionsAgregationKpi,
): ValeurPeriodeKpi[] {
  const mode = options.agregation ?? agregationKpiParDefaut(options.nature);
  const lues = lireMesures(mesures, options.frequence);
  if (mode === "derniere") refuserDatesEnDouble(lues);
  const bornes = intervalle(lues, options);
  if (bornes === null) return [];
  const parRang = new Map<number, MesureLue[]>();
  for (const m of lues) {
    const groupe = parRang.get(m.rang);
    if (groupe === undefined) parRang.set(m.rang, [m]);
    else groupe.push(m);
  }
  return periodesKpiParRang(bornes.premier, bornes.dernier, options.frequence).map((periode) => {
    const groupe = parRang.get(periode.rang) ?? [];
    if (groupe.length === 0) {
      return { periode, valeur: null, valeurExacte: null, nombreMesures: 0 };
    }
    const valeur = agreger(groupe, mode);
    return {
      periode,
      valeur: arrondir(valeur),
      valeurExacte: versTexte(valeur),
      nombreMesures: groupe.length,
    };
  });
}
