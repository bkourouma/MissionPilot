/**
 * Calendrier ouvré (SOC-04) : semaine de travail paramétrable et jours fériés
 * fournis par l'appelant (voir `feriesParDefaut` dans feries.ts).
 */
import { type DateISO, type Periode, jourSemaine, versDateISO, versJourUTC } from "./dates";

/** Paramètres d'un calendrier de travail. */
export interface ParametresCalendrier {
  /** Jours travaillés, 1 = lundi … 7 = dimanche. Défaut : lundi à vendredi. */
  readonly joursTravailles?: readonly number[];
  /** Jours fériés chômés (dates ISO). */
  readonly feries?: readonly DateISO[];
}

/** Semaine de travail par défaut : lundi à vendredi. */
export const SEMAINE_DEFAUT: readonly number[] = [1, 2, 3, 4, 5];

interface CalendrierCompile {
  readonly jours: ReadonlySet<number>;
  readonly feries: ReadonlySet<number>;
}

function compiler(params: ParametresCalendrier): CalendrierCompile {
  const jours = params.joursTravailles ?? SEMAINE_DEFAUT;
  for (const j of jours) {
    if (!Number.isInteger(j) || j < 1 || j > 7) {
      throw new RangeError(`Jour de semaine invalide : ${j} (attendu 1 à 7)`);
    }
  }
  return {
    jours: new Set(jours),
    feries: new Set((params.feries ?? []).map(versJourUTC)),
  };
}

function ouvre(cal: CalendrierCompile, jourUTC: number): boolean {
  const semaine = ((((jourUTC + 3) % 7) + 7) % 7) + 1;
  return cal.jours.has(semaine) && !cal.feries.has(jourUTC);
}

/** Indique si la date est un jour ouvré (jour travaillé et non férié). */
export function estJourOuvre(date: DateISO, params: ParametresCalendrier = {}): boolean {
  const cal = compiler(params);
  return cal.jours.has(jourSemaine(date)) && !cal.feries.has(versJourUTC(date));
}

/** Liste les jours ouvrés d'une période (bornes incluses ; vide si inversée). */
export function listerJoursOuvres(periode: Periode, params: ParametresCalendrier = {}): DateISO[] {
  const cal = compiler(params);
  const resultat: DateISO[] = [];
  const fin = versJourUTC(periode.fin);
  for (let j = versJourUTC(periode.debut); j <= fin; j++) {
    if (ouvre(cal, j)) resultat.push(versDateISO(j));
  }
  return resultat;
}

/** Nombre de jours ouvrés entre deux dates, bornes incluses (0 si fin < début). */
export function joursOuvresEntre(
  debut: DateISO,
  fin: DateISO,
  params: ParametresCalendrier = {},
): number {
  return listerJoursOuvres({ debut, fin }, params).length;
}

/**
 * Ajoute `n` jours ouvrés à une date (retire si `n` est négatif).
 * - `n = 0` : la date si elle est ouvrée, sinon le jour ouvré suivant ;
 * - `n > 0` : le n-ième jour ouvré strictement après la date ;
 * - `n < 0` : le |n|-ième jour ouvré strictement avant la date.
 */
export function ajouterJoursOuvres(
  date: DateISO,
  n: number,
  params: ParametresCalendrier = {},
): DateISO {
  if (!Number.isInteger(n)) throw new RangeError(`Nombre de jours ouvrés non entier : ${n}`);
  const cal = compiler(params);
  if (cal.jours.size === 0) throw new RangeError("Calendrier sans aucun jour travaillé");
  let j = versJourUTC(date);
  if (n === 0) {
    while (!ouvre(cal, j)) j++;
    return versDateISO(j);
  }
  const pas = n > 0 ? 1 : -1;
  for (let restant = Math.abs(n); restant > 0;) {
    j += pas;
    if (ouvre(cal, j)) restant--;
  }
  return versDateISO(j);
}
