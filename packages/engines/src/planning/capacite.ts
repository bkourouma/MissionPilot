/**
 * Capacité, affectations et taux d'occupation (PLN-04, PLN-06, PLN-07).
 *
 *   Capacité = (jours ouvrés − fériés − absences) × temps de travail %
 *   Taux d'occupation = jours affectés / capacité
 *
 * Calculs en centièmes de jour ; résultats en jours arrondis au centième.
 */
import { ratioArrondi } from "../commun/ratio";
import { type ParametresCalendrier, cleCalendrier, listerJoursOuvresUTC } from "./calendrier";
import { type DateISO, type Periode, versJourUTC, verifierPeriode } from "./dates";
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

/** Absence ramenée en jours UTC ; la fraction n'est validée qu'à l'usage. */
interface AbsenceUTC {
  readonly debut: number;
  readonly fin: number;
  readonly source: Absence;
}

/** Centièmes d'absence d'un jour donné (plafonné à un jour entier). */
function absenceDuJour(jourUTC: number, absences: readonly AbsenceUTC[]): number {
  let total = 0;
  for (const a of absences) {
    if (jourUTC >= a.debut && jourUTC <= a.fin) total += fractionAbsence(a.source);
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
  const absencesUTC = absences.map((a) => ({
    debut: versJourUTC(a.debut),
    fin: versJourUTC(a.fin),
    source: a,
  }));
  let disponibles = 0;
  for (const jour of listerJoursOuvresUTC(periode, calendrier)) {
    disponibles += CENTIEMES_PAR_JOUR - absenceDuJour(jour, absencesUTC);
  }
  return depuisCentiemes(arrondiEntier((disponibles * tempsTravailPct) / 100));
}

/**
 * Affectation préparée pour des calculs répétés sur plusieurs périodes : ses
 * jours ouvrés (jours UTC croissants) sont listés une seule fois.
 */
export interface AffectationPreparee {
  /** Premier et dernier jour UTC de l'affectation. */
  readonly debut: number;
  readonly fin: number;
  /** Jours alloués en centièmes. */
  readonly total: number;
  /** Jours ouvrés de l'affectation, en jours UTC croissants. */
  readonly ouvres: readonly number[];
}

/**
 * Valide une affectation et liste une fois ses jours ouvrés selon le
 * calendrier, pour `joursAffectesPrepares`.
 */
export function preparerAffectation(
  aff: Affectation,
  calendrier: ParametresCalendrier = {},
): AffectationPreparee {
  verifierPeriode(aff);
  if (!Number.isFinite(aff.joursAlloues) || aff.joursAlloues < 0) {
    throw new RangeError(`Jours alloués invalides : ${aff.joursAlloues}`);
  }
  return {
    debut: versJourUTC(aff.debut),
    fin: versJourUTC(aff.fin),
    total: versCentiemes(aff.joursAlloues),
    ouvres: listerJoursOuvresUTC(aff, calendrier),
  };
}

/** Nombre d'éléments de la liste croissante inférieurs ou égaux à `limite`. */
function compterJusqua(ouvres: readonly number[], limite: number): number {
  let bas = 0;
  let haut = ouvres.length;
  while (bas < haut) {
    const milieu = (bas + haut) >>> 1;
    if ((ouvres[milieu] as number) <= limite) bas = milieu + 1;
    else haut = milieu;
  }
  return bas;
}

/** Centièmes alloués cumulés jusqu'au jour UTC inclus (prorata des jours ouvrés). */
function cumulAlloue(prep: AffectationPreparee, limite: number): number {
  const n = prep.ouvres.length;
  if (n === 0) return limite >= prep.debut ? prep.total : 0;
  return arrondiEntier((prep.total * compterJusqua(prep.ouvres, limite)) / n);
}

/**
 * Jours d'une affectation préparée tombant dans une période : même résultat
 * que `joursAffectesSurPeriode`, en temps logarithmique par période.
 */
export function joursAffectesPrepares(prep: AffectationPreparee, periode: Periode): number {
  verifierPeriode(periode);
  const debut = versJourUTC(periode.debut);
  const fin = versJourUTC(periode.fin);
  if (debut > prep.fin || fin < prep.debut) return 0;
  return depuisCentiemes(cumulAlloue(prep, fin) - cumulAlloue(prep, debut - 1));
}

/** Dernière préparation par affectation, réutilisée si rien n'a changé. */
interface PreparationMemorisee {
  readonly debut: DateISO;
  readonly fin: DateISO;
  readonly joursAlloues: number;
  readonly cle: object;
  readonly prep: AffectationPreparee;
}
const preparations = new WeakMap<Affectation, PreparationMemorisee>();

/**
 * Jours d'une affectation tombant dans une période, répartis au prorata des
 * jours ouvrés de l'affectation. Le calcul par cumul garantit que la somme sur
 * des périodes contiguës couvrant l'affectation redonne exactement les jours
 * alloués. Une affectation sans jour ouvré est rattachée à sa date de début.
 * Les jours ouvrés de l'affectation sont mémorisés entre deux appels.
 */
export function joursAffectesSurPeriode(
  aff: Affectation,
  periode: Periode,
  calendrier: ParametresCalendrier = {},
): number {
  // Contrôles et ordre des erreurs identiques à la version sans mémoire.
  verifierPeriode(aff);
  verifierPeriode(periode);
  if (!Number.isFinite(aff.joursAlloues) || aff.joursAlloues < 0) {
    throw new RangeError(`Jours alloués invalides : ${aff.joursAlloues}`);
  }
  if (
    versJourUTC(periode.debut) > versJourUTC(aff.fin) ||
    versJourUTC(periode.fin) < versJourUTC(aff.debut)
  ) {
    return 0;
  }
  const cle = cleCalendrier(calendrier);
  const memo = preparations.get(aff);
  let prep: AffectationPreparee;
  if (
    memo?.cle === cle &&
    memo.debut === aff.debut &&
    memo.fin === aff.fin &&
    memo.joursAlloues === aff.joursAlloues
  ) {
    prep = memo.prep;
  } else {
    prep = preparerAffectation(aff, calendrier);
    preparations.set(aff, {
      debut: aff.debut,
      fin: aff.fin,
      joursAlloues: aff.joursAlloues,
      cle,
      prep,
    });
  }
  return joursAffectesPrepares(prep, periode);
}

/**
 * Taux d'occupation (0,9 = 90 %) arrondi à 4 décimales, `null` si la capacité
 * est nulle. `etatCharge` compare les seuils sur les valeurs exactes.
 */
export function tauxOccupation(joursAffectes: number, capaciteJours: number): number | null {
  return ratioArrondi(versCentiemes(joursAffectes), versCentiemes(capaciteJours));
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
