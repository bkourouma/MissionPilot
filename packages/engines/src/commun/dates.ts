/**
 * Socle commun des dates civiles ISO « AAAA-MM-JJ » (planning et finance).
 *
 * Une date est manipulée en jours entiers UTC depuis le 1970-01-01 : aucun
 * fuseau local, aucune horloge (la date du jour est toujours un paramètre).
 * Ce module ne lève aucune erreur : chaque domaine traduit l'échec dans sa
 * propre famille d'erreurs (`RangeError` côté planning, `ErreurFinance` côté
 * finance).
 */

/** Date civile au format `AAAA-MM-JJ`. */
export type DateISO = string;

export const MS_PAR_JOUR = 86_400_000;
const FORMAT_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Jour UTC d'une date donnée par ses composantes (mois 1-12). Les débordements
 * sont normalisés comme par `Date` (mois 13 → janvier suivant, jour 0 → veille).
 * `setUTCFullYear` évite la projection des années 0-99 sur 1900-1999 que fait
 * `Date.UTC`.
 */
export function jourUTCDepuisComposantes(annee: number, mois: number, jour: number): number {
  const d = new Date(0);
  d.setUTCFullYear(annee, mois - 1, jour);
  return Math.round(d.getTime() / MS_PAR_JOUR);
}

/** Date ISO d'un jour UTC (année sur 4 chiffres). */
export function dateISODepuisJourUTC(jourUTC: number): DateISO {
  const d = new Date(jourUTC * MS_PAR_JOUR);
  const annee = String(d.getUTCFullYear()).padStart(4, "0");
  return `${annee}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}`;
}

/** Résultat de l'analyse d'une date ISO. */
export type AnalyseDateISO =
  | { readonly valide: true; readonly jourUTC: number }
  | { readonly valide: false; readonly raison: "format" | "inexistante" };

/**
 * Analyse une date ISO : format `AAAA-MM-JJ`, puis existence vérifiée par
 * aller-retour (`dateISODepuisJourUTC(jour) === date`), ce qui refuse le
 * 30 février comme le mois 13.
 */
export function analyserDateISO(date: string): AnalyseDateISO {
  const m = FORMAT_ISO.exec(date);
  if (!m) return { valide: false, raison: "format" };
  const jourUTC = jourUTCDepuisComposantes(Number(m[1]), Number(m[2]), Number(m[3]));
  if (dateISODepuisJourUTC(jourUTC) !== date) return { valide: false, raison: "inexistante" };
  return { valide: true, jourUTC };
}

/** Jour de la semaine ISO d'un jour UTC : 1 = lundi … 7 = dimanche. */
export function jourSemaineDepuisJourUTC(jourUTC: number): number {
  // Le 1970-01-01 (jour 0) était un jeudi (4).
  return ((((jourUTC + 3) % 7) + 7) % 7) + 1;
}
