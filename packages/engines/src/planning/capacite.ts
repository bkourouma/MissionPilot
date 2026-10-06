/**
 * Capacité, affectations et taux d'occupation (PLN-04, PLN-06, PLN-07).
 *
 *   Capacité = (jours ouvrés − fériés − absences) × temps de travail %
 *   Taux d'occupation = jours affectés / capacité
 *
 * Calculs en centièmes de jour ; résultats en jours arrondis au centième.
 */
import { type ParametresCalendrier, listerJoursOuvres } from "./calendrier";
import {
  type DateISO,
  type Periode,
  ajouterJours,
  dansPeriode,
  intersection,
  versJourUTC,
  verifierPeriode,
} from "./dates";
import { arrondiEntier, CENTIEMES_PAR_JOUR, depuisCentiemes, versCentiemes } from "./unites";

/** Absence validée (congé, maladie…), bornes incluses. */
export interface Absence {
  readonly debut: DateISO;
  readonly fin: DateISO;
  /** Part de chaque jour absente, dans ]0 ; 1] (0,5 = demi-journées). Défaut 1. */
  readonly fractionJour?: number;
}

/** Affectation nominative : personne, tâche, jours alloués, période (PLN-04). */
export interface Affectation {
  readonly id: string;
  readonly personneId: string;
  readonly tacheId: string;
  readonly joursAlloues: number;
  readonly debut: DateISO;
  readonly fin: DateISO;
}

function fractionAbsence(absence: Absence): number {
  const f = absence.fractionJour ?? 1;
  if (!Number.isFinite(f) || f <= 0 || f > 1) {
    throw new RangeError(`Fraction de jour d'absence invalide : ${f}`);
  }
  return versCentiemes(f);
}

/** Centièmes d'absence d'un jour donné (plafonné à un jour entier). */
function absenceDuJour(date: DateISO, absences: readonly Absence[]): number {
  let total = 0;
  for (const a of absences) {
    if (dansPeriode(date, a)) total += fractionAbsence(a);
  }
  return Math.min(total, CENTIEMES_PAR_JOUR);
}

/**
 * Capacité d'un collaborateur sur une période, en jours. Les fériés passent
 * par le calendrier ; une absence un jour non ouvré ne retire rien.
 */
export function capacite(
  periode: Periode,
  calendrier: ParametresCalendrier = {},
  absences: readonly Absence[] = [],
  tempsTravailPct = 100,
): number {
  verifierPeriode(periode);
  if (!Number.isFinite(tempsTravailPct) || tempsTravailPct < 0 || tempsTravailPct > 100) {
    throw new RangeError(`Temps de travail invalide : ${tempsTravailPct} % (attendu 0 à 100)`);
  }
  for (const a of absences) verifierPeriode(a);
  let disponibles = 0;
  for (const jour of listerJoursOuvres(periode, calendrier)) {
    disponibles += CENTIEMES_PAR_JOUR - absenceDuJour(jour, absences);
  }
  return depuisCentiemes(arrondiEntier((disponibles * tempsTravailPct) / 100));
}

/** Centièmes alloués cumulés jusqu'à la date incluse (prorata des jours ouvrés). */
function cumulAlloue(aff: Affectation, ouvres: readonly DateISO[], date: DateISO): number {
  const total = versCentiemes(aff.joursAlloues);
  if (ouvres.length === 0) return versJourUTC(date) >= versJourUTC(aff.debut) ? total : 0;
  const limite = versJourUTC(date);
  const ecoules = ouvres.filter((j) => versJourUTC(j) <= limite).length;
  return arrondiEntier((total * ecoules) / ouvres.length);
}

/**
 * Jours d'une affectation tombant dans une période, répartis au prorata des
 * jours ouvrés de l'affectation. Le calcul par cumul garantit que la somme sur
 * des périodes contiguës couvrant l'affectation redonne exactement les jours
 * alloués. Une affectation sans jour ouvré est rattachée à sa date de début.
 */
export function joursAffectesSurPeriode(
  aff: Affectation,
  periode: Periode,
  calendrier: ParametresCalendrier = {},
): number {
  verifierPeriode(aff);
  verifierPeriode(periode);
  if (!Number.isFinite(aff.joursAlloues) || aff.joursAlloues < 0) {
    throw new RangeError(`Jours alloués invalides : ${aff.joursAlloues}`);
  }
  if (intersection(aff, periode) === null) return 0;
  const ouvres = listerJoursOuvres(aff, calendrier);
  const avant = cumulAlloue(aff, ouvres, ajouterJours(periode.debut, -1));
  return depuisCentiemes(cumulAlloue(aff, ouvres, periode.fin) - avant);
}

/** Taux d'occupation (0,9 = 90 %), `null` si la capacité est nulle. */
export function tauxOccupation(joursAffectes: number, capaciteJours: number): number | null {
  const cap = versCentiemes(capaciteJours);
  return cap === 0 ? null : versCentiemes(joursAffectes) / cap;
}

/** État de charge d'une cellule du plan de charge. */
export type EtatCharge = "surcharge" | "normal" | "sous_occupation" | "indisponible";

/**
 * Seuils de charge en % de la capacité. Défauts (à valider par le métier) :
 * surcharge au-delà de 100 %, sous-occupation en dessous de 50 %.
 */
export interface SeuilsCharge {
  readonly surchargePct: number;
  readonly sousOccupationPct: number;
}

export const SEUILS_CHARGE_DEFAUT: SeuilsCharge = { surchargePct: 100, sousOccupationPct: 50 };

/**
 * Classe une charge : capacité nulle → `indisponible` sans affectation,
 * `surcharge` sinon ; surcharge si affecté > capacité × seuil ; sous-occupation
 * si affecté < capacité × seuil.
 */
export function etatCharge(
  joursAffectes: number,
  capaciteJours: number,
  seuils: SeuilsCharge = SEUILS_CHARGE_DEFAUT,
): EtatCharge {
  const aff = versCentiemes(joursAffectes);
  const cap = versCentiemes(capaciteJours);
  if (cap === 0) return aff > 0 ? "surcharge" : "indisponible";
  if (aff * 100 > cap * seuils.surchargePct) return "surcharge";
  if (aff * 100 < cap * seuils.sousOccupationPct) return "sous_occupation";
  return "normal";
}
