/**
 * Alertes déterministes d'un KPI (KPI-04). Aucune notification ici : ces
 * fonctions disent seulement si une alerte est due, avec ses éléments
 * chiffrés ; l'envoi (in-app, e-mail) relève de l'API.
 *
 * - Dégradation : la valeur se dégrade, dans le sens de lecture du KPI, sur N
 *   périodes consécutives (N variations défavorables d'affilée jusqu'à la
 *   dernière période ; une période non mesurée rompt la suite). Une variation
 *   n'est défavorable que si elle dépasse `toleranceRelative` × |valeur
 *   précédente| (défaut 0 : toute baisse stricte compte).
 * - Retard de mesure : la période attendue est la plus récente dont
 *   l'échéance (dernier jour + délai de grâce) est passée à la date de
 *   référence. Le KPI est en retard si aucune mesure ne couvre cette période
 *   ni une période ultérieure. Le suivi commence à `suiviDepuis` (défaut :
 *   la première mesure) ; les trous antérieurs à la dernière mesure ne sont
 *   pas des retards (ils se voient dans la série agrégée).
 * - Seuils : valeur strictement au-dessus du seuil haut, strictement sous le
 *   seuil bas, variation relative à la période précédente strictement
 *   supérieure à `variationMax` (en valeur absolue ; depuis une valeur
 *   précédente nulle, toute variation non nulle alerte).
 */
import { dateISODepuisJourUTC, type DateISO } from "../commun/dates";
import type { SensLectureKpi } from "./atteinte";
import { ErreurKpi } from "./erreurs";
import {
  absolu,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  multiplier,
  oppose,
  soustraire,
  type Fraction,
} from "./fraction";
import { jourKpi, periodeKpiDepuisRang, rangKpiDuJour, type FrequenceKpi } from "./periodes";
import { toleranceKpi } from "./tendance";

export const PERIODES_DEGRADATION_KPI_DEFAUT = 3;
export const DELAI_GRACE_KPI_DEFAUT_JOURS = 5;
const DELAI_GRACE_MAX_JOURS = 3660;

export type AlerteKpi =
  | {
      readonly code: "DEGRADATION_CONSECUTIVE";
      readonly periodes: number;
      readonly seuil: number;
    }
  | {
      readonly code: "MESURE_EN_RETARD";
      /** Plus ancienne période attendue sans mesure. */
      readonly periodeAttendue: string;
      readonly echeance: DateISO;
      readonly joursDeRetard: number;
      /** Périodes dues sans mesure, de `periodeAttendue` à `dernierePeriodeDue`. */
      readonly periodesManquantes: number;
      readonly dernierePeriodeDue: string;
    }
  | { readonly code: "SEUIL_HAUT"; readonly valeur: number; readonly seuil: number }
  | { readonly code: "SEUIL_BAS"; readonly valeur: number; readonly seuil: number }
  | {
      readonly code: "VARIATION";
      readonly valeur: number;
      readonly precedente: number;
      /** (valeur − précédente) / |précédente|, 4 décimales ; `null` si la précédente est nulle. */
      readonly variationRelative: number | null;
      readonly seuil: number;
    };

export interface OptionsDegradationKpi {
  /** Nombre de variations défavorables consécutives qui déclenche l'alerte (défaut 3). */
  readonly periodes?: number;
  readonly toleranceRelative?: number;
}

function estDegradation(
  avant: Fraction,
  apres: Fraction,
  sens: SensLectureKpi,
  tolerance: Fraction,
): boolean {
  const ecart = soustraire(apres, avant);
  const oriente = sens === "plus_haut_mieux" ? ecart : oppose(ecart);
  return oriente.num < 0n && comparer(absolu(oriente), multiplier(tolerance, absolu(avant))) > 0;
}

/** Nombre de variations défavorables consécutives qui aboutissent à la dernière période. */
export function degradationsConsecutivesKpi(
  valeurs: readonly (number | null)[],
  sens: SensLectureKpi,
  options: Pick<OptionsDegradationKpi, "toleranceRelative"> = {},
): number {
  const tolerance = toleranceKpi(options.toleranceRelative, 0, "La tolérance relative");
  let compte = 0;
  for (let i = valeurs.length - 1; i >= 1; i--) {
    const apres = valeurs[i];
    const avant = valeurs[i - 1];
    if (apres == null || avant == null) break;
    const a = depuisNombre(avant, `La valeur ${i}`);
    if (!estDegradation(a, depuisNombre(apres, `La valeur ${i + 1}`), sens, tolerance)) break;
    compte++;
  }
  return compte;
}

/** Alerte si la valeur se dégrade sur au moins N périodes consécutives. */
export function alerteDegradationKpi(
  valeurs: readonly (number | null)[],
  sens: SensLectureKpi,
  options: OptionsDegradationKpi = {},
): AlerteKpi | null {
  const seuil = options.periodes ?? PERIODES_DEGRADATION_KPI_DEFAUT;
  if (!Number.isSafeInteger(seuil) || seuil < 1) {
    throw new ErreurKpi(
      "OPTIONS_INVALIDES",
      "Le nombre de périodes de dégradation est un entier ≥ 1.",
    );
  }
  const periodes = degradationsConsecutivesKpi(valeurs, sens, options);
  return periodes >= seuil ? { code: "DEGRADATION_CONSECUTIVE", periodes, seuil } : null;
}

export interface EntreeRetardKpi {
  readonly frequence: FrequenceKpi;
  /** Dates des mesures saisies (une date quelconque de la période mesurée). */
  readonly datesMesures: readonly DateISO[];
  readonly dateReference: DateISO;
  /** Début du suivi ; défaut : date de la première mesure. */
  readonly suiviDepuis?: DateISO;
  /** Jours accordés après la fin d'une période pour la mesurer (défaut 5). */
  readonly delaiGraceJours?: number;
}

function lireDelai(delai: number | undefined): number {
  const d = delai ?? DELAI_GRACE_KPI_DEFAUT_JOURS;
  if (!Number.isSafeInteger(d) || d < 0 || d > DELAI_GRACE_MAX_JOURS) {
    throw new ErreurKpi(
      "OPTIONS_INVALIDES",
      `Le délai de grâce est un nombre entier de jours entre 0 et ${DELAI_GRACE_MAX_JOURS}.`,
    );
  }
  return d;
}

/** Rang de la période la plus récente dont l'échéance est passée à `reference`. */
function derniereDue(frequence: FrequenceKpi, reference: number, delai: number): number {
  let rang = rangKpiDuJour(reference, frequence) - 1;
  while (jourKpi(periodeKpiDepuisRang(frequence, rang).fin) + delai >= reference) rang--;
  return rang;
}

/** Alerte si la mesure attendue à la date de référence manque. */
export function alerteRetardKpi(entree: EntreeRetardKpi): AlerteKpi | null {
  const { frequence } = entree;
  const delai = lireDelai(entree.delaiGraceJours);
  const reference = jourKpi(entree.dateReference, "La date de référence");
  const rangs = entree.datesMesures.map((d, i) =>
    rangKpiDuJour(jourKpi(d, `La date de la mesure ${i + 1}`), frequence),
  );
  const debutSuivi =
    entree.suiviDepuis === undefined
      ? rangs.reduce<number | null>((min, r) => (min === null || r < min ? r : min), null)
      : rangKpiDuJour(jourKpi(entree.suiviDepuis, "Le début du suivi"), frequence);
  if (debutSuivi === null) return null;
  const derniereMesuree = rangs.reduce((max, r) => (r > max ? r : max), debutSuivi - 1);
  const premierManquant = derniereMesuree + 1;
  const due = derniereDue(frequence, reference, delai);
  if (premierManquant > due) return null;
  const attendue = periodeKpiDepuisRang(frequence, premierManquant);
  const echeance = jourKpi(attendue.fin) + delai;
  return {
    code: "MESURE_EN_RETARD",
    periodeAttendue: attendue.cle,
    echeance: dateISODepuisJourUTC(echeance),
    joursDeRetard: reference - echeance,
    periodesManquantes: due - premierManquant + 1,
    dernierePeriodeDue: periodeKpiDepuisRang(frequence, due).cle,
  };
}

export interface SeuilsAlerteKpi {
  /** Alerte si la valeur est strictement au-dessus. */
  readonly haut?: number | null;
  /** Alerte si la valeur est strictement en dessous. */
  readonly bas?: number | null;
  /** Variation relative absolue maximale admise d'une période à l'autre (0,2 = 20 %). */
  readonly variationMax?: number | null;
}

interface SeuilsLus {
  readonly haut: Fraction | null;
  readonly bas: Fraction | null;
  readonly variationMax: Fraction | null;
}

function lireSeuils(seuils: SeuilsAlerteKpi): SeuilsLus {
  const haut = seuils.haut == null ? null : depuisNombre(seuils.haut, "Le seuil haut");
  const bas = seuils.bas == null ? null : depuisNombre(seuils.bas, "Le seuil bas");
  if (haut !== null && bas !== null && comparer(bas, haut) > 0) {
    throw new ErreurKpi("SEUILS_INVALIDES", "Le seuil bas dépasse le seuil haut.");
  }
  const variationMax =
    seuils.variationMax == null
      ? null
      : toleranceKpi(seuils.variationMax, 0, "La variation maximale");
  return { haut, bas, variationMax };
}

function alerteVariation(
  valeur: number,
  precedente: number,
  maximum: Fraction,
  seuil: number,
): AlerteKpi | null {
  const p = depuisNombre(precedente, "La valeur précédente");
  const ecart = soustraire(depuisNombre(valeur, "La valeur"), p);
  if (estNul(p)) {
    if (estNul(ecart)) return null;
    return { code: "VARIATION", valeur, precedente, variationRelative: null, seuil };
  }
  const relative = diviser(ecart, absolu(p));
  if (comparer(absolu(relative), maximum) <= 0) return null;
  return { code: "VARIATION", valeur, precedente, variationRelative: arrondir(relative), seuil };
}

/**
 * Alertes de seuil d'une valeur (KPI-04) : haut, bas et variation depuis la
 * période précédente. Sans valeur : aucune alerte. Les seuils sont validés
 * même sans valeur.
 */
export function alertesSeuilsKpi(
  valeur: number | null | undefined,
  precedente: number | null | undefined,
  seuils: SeuilsAlerteKpi,
): AlerteKpi[] {
  const lus = lireSeuils(seuils);
  if (valeur == null) return [];
  const v = depuisNombre(valeur, "La valeur");
  const alertes: AlerteKpi[] = [];
  if (lus.haut !== null && comparer(v, lus.haut) > 0) {
    alertes.push({ code: "SEUIL_HAUT", valeur, seuil: seuils.haut as number });
  }
  if (lus.bas !== null && comparer(v, lus.bas) < 0) {
    alertes.push({ code: "SEUIL_BAS", valeur, seuil: seuils.bas as number });
  }
  if (lus.variationMax !== null && precedente != null) {
    const alerte = alerteVariation(
      valeur,
      precedente,
      lus.variationMax,
      seuils.variationMax as number,
    );
    if (alerte !== null) alertes.push(alerte);
  }
  return alertes;
}
