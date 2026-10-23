/** Redressement (saisie) : contrôles de forme communs, montants, dates et codes de lignes. */
import { RED_MONTANT_MAX } from "@missionpilot/shared";
import type { Devise } from "./format";
import { ajouterJoursIso } from "./kpi";
import { lireMontant, lireNombre } from "./saisie";

export type Erreurs<K extends string> = Partial<Record<K, string>>;

export const MSG_DATE = "Date illisible : saisissez une date entre 2000 et 2100.";
export const MSG_MONTANT = (devise: Devise) =>
  devise === "XOF" || devise === "XAF"
    ? "Montant illisible : saisissez un nombre entier, sans décimale (ex. 1 200 000)."
    : "Montant illisible : saisissez un nombre positif, avec deux décimales au plus (ex. 1 500,50).";

// --- Montants et dates ------------------------------------------------------------------------------

/**
 * Montant saisi (unités usuelles) → unités mineures. `null` si vide, `NaN` si illisible, négatif,
 * trop précis pour la devise ou au-delà du plafond de l'API.
 */
export function lireMontantRed(v: string, devise: Devise): number | null {
  const m = lireMontant(v, devise);
  if (m === null) return null;
  return Number.isNaN(m) || m > RED_MONTANT_MAX ? Number.NaN : m;
}

/** Solde saisi : comme un montant, mais négatif admis (« -250 000 », « −250 000 »). */
export function lireSolde(v: string, devise: Devise): number | null {
  const t = v.trim();
  if (t === "") return null;
  const negatif = /^[-−]/.test(t);
  const m = lireMontantRed(negatif ? t.slice(1) : t, devise);
  if (m === null || Number.isNaN(m)) return Number.NaN;
  return negatif && m !== 0 ? -m : m;
}

/** Entier saisi (texte) : `null` si vide, `NaN` si illisible, décimal ou hors bornes. */
export function lireEntier(v: string, min: number, max: number): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n) || !Number.isInteger(n) || n < min || n > max) return Number.NaN;
  return n;
}

/** Jour de semaine UTC = lundi (les semaines de la trésorerie commencent un lundi). */
export function estLundi(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

/** Premier lundi strictement après la date donnée (valeur de départ d'une première version). */
export function prochainLundi(date: string): string {
  const jour = new Date(`${date}T00:00:00Z`).getUTCDay();
  return ajouterJoursIso(date, (8 - jour) % 7 || 7);
}

// --- Codes de lignes (correspondance de postes) -------------------------------------------------------

export const FORMAT_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
export const CODES_PAR_POSTE_MAX = 50;

/**
 * « BB, bi » → ["BB", "BI"] : séparateurs virgule, point-virgule ou espace ; vides et doublons
 * écartés. Un code retrouvé (sans tenir compte de la casse) dans `connus` prend l'écriture de
 * l'état du client ; sinon il est mis en majuscules (convention des références SYSCOHADA).
 */
export function parserCodes(texte: string, connus: readonly string[] = []): string[] {
  const parCasse = new Map(connus.map((c) => [c.toUpperCase(), c]));
  const sortie: string[] = [];
  const vus = new Set<string>();
  for (const brut of texte.split(/[,;\s]+/)) {
    const t = brut.trim();
    if (t === "") continue;
    const code = parCasse.get(t.toUpperCase()) ?? t.toUpperCase();
    if (vus.has(code)) continue;
    vus.add(code);
    sortie.push(code);
  }
  return sortie;
}
