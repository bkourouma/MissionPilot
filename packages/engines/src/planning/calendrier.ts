/**
 * Calendrier ouvré (SOC-04) : semaine de travail paramétrable et jours fériés
 * fournis par l'appelant (voir `feriesParDefaut` dans feries.ts).
 */
import { jourSemaineDepuisJourUTC } from "../commun/dates";
import { type DateISO, type Periode, versDateISO, versJourUTC } from "./dates";

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

function compilerSansCache(
  jours: readonly number[],
  feries: readonly DateISO[],
): CalendrierCompile {
  for (const j of jours) {
    if (!Number.isInteger(j) || j < 1 || j > 7) {
      throw new RangeError(`Jour de semaine invalide : ${j} (attendu 1 à 7)`);
    }
  }
  return { jours: new Set(jours), feries: new Set(feries.map(versJourUTC)) };
}

/** Calendrier compilé et copie des listes d'origine, pour détecter une mutation. */
interface EntreeCache {
  readonly jours: readonly number[];
  readonly feries: readonly DateISO[];
  readonly cal: CalendrierCompile;
}

const AUCUN_FERIE: readonly DateISO[] = [];
/** Mémoïsation par listes (fériés, puis jours travaillés), indépendante de l'objet paramètres. */
const cache = new WeakMap<readonly DateISO[], WeakMap<readonly number[], EntreeCache>>();

function memesValeurs<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Compile un calendrier (ensembles des jours travaillés et des fériés) une
 * seule fois par couple de listes. Le cache compare le contenu à une copie :
 * une liste modifiée en place est recompilée.
 */
function compiler(params: ParametresCalendrier): CalendrierCompile {
  const jours = params.joursTravailles ?? SEMAINE_DEFAUT;
  const feries = params.feries ?? AUCUN_FERIE;
  let parJours = cache.get(feries);
  const connu = parJours?.get(jours);
  if (connu && memesValeurs(connu.jours, jours) && memesValeurs(connu.feries, feries)) {
    return connu.cal;
  }
  const cal = compilerSansCache(jours, feries);
  if (!parJours) {
    parJours = new WeakMap();
    cache.set(feries, parJours);
  }
  parJours.set(jours, { jours: [...jours], feries: [...feries], cal });
  return cal;
}

function ouvre(cal: CalendrierCompile, jourUTC: number): boolean {
  return cal.jours.has(jourSemaineDepuisJourUTC(jourUTC)) && !cal.feries.has(jourUTC);
}

/** Indique si la date est un jour ouvré (jour travaillé et non férié). */
export function estJourOuvre(date: DateISO, params: ParametresCalendrier = {}): boolean {
  const cal = compiler(params);
  return ouvre(cal, versJourUTC(date));
}

/**
 * Jours ouvrés d'une période en numéros de jour UTC croissants (bornes
 * incluses ; vide si inversée). Variante sans conversion en texte de
 * `listerJoursOuvres`, pour les calculs répétés.
 */
export function listerJoursOuvresUTC(
  periode: Periode,
  params: ParametresCalendrier = {},
): number[] {
  const cal = compiler(params);
  const resultat: number[] = [];
  const fin = versJourUTC(periode.fin);
  for (let j = versJourUTC(periode.debut); j <= fin; j++) {
    if (ouvre(cal, j)) resultat.push(j);
  }
  return resultat;
}

/** Liste les jours ouvrés d'une période (bornes incluses ; vide si inversée). */
export function listerJoursOuvres(periode: Periode, params: ParametresCalendrier = {}): DateISO[] {
  return listerJoursOuvresUTC(periode, params).map(versDateISO);
}

/** Nombre de jours ouvrés entre deux dates, bornes incluses (0 si fin < début). */
export function joursOuvresEntre(
  debut: DateISO,
  fin: DateISO,
  params: ParametresCalendrier = {},
): number {
  return listerJoursOuvresUTC({ debut, fin }, params).length;
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

/**
 * Identité stable du calendrier compilé (même objet tant que les jours
 * travaillés et les fériés sont inchangés) : sert de clé aux mémoïsations des
 * moteurs. Lève une `RangeError` si le calendrier est invalide.
 */
export function cleCalendrier(params: ParametresCalendrier = {}): object {
  return compiler(params);
}
