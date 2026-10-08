/**
 * Lecture des saisies de formulaire (sans React), testée dans `saisie.test.ts`.
 * Ces fonctions convertissent un texte saisi en valeur ; elles ne calculent aucun chiffre métier.
 */
import type { Devise } from "./format";

export const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Texte saisi → chaîne nettoyée, ou `null` si vide. */
export function texteOuNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Nombre saisi à la française : « 2,5 », « 1 500 », « 1 500,5 ». `null` si vide,
 * `Number.NaN` si illisible.
 */
export function lireNombre(v: string): number | null {
  // \s couvre aussi les espaces insécables (U+00A0, U+202F) des nombres copiés-collés.
  const brut = v.replace(/\s/g, "").replace(",", ".");
  if (brut === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(brut)) return Number.NaN;
  return Number(brut);
}

/** « audit, finance ; RH » → ["audit", "finance", "RH"], sans doublon ni élément vide. */
export function decouperListe(v: string): string[] {
  const elements = v
    .split(/[,;\n]/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
  return [...new Set(elements)];
}

/** Liste → texte modifiable dans un champ (« audit, finance »). */
export function joindreListe(liste: readonly string[] | null | undefined): string {
  return (liste ?? []).join(", ");
}

/** Le franc CFA n'a pas de subdivision ; l'euro et le dollar se stockent en centimes. */
const FACTEUR_MINEUR: Record<Devise, number> = { XOF: 1, XAF: 1, EUR: 100, USD: 100 };

/**
 * Montant saisi (unités usuelles) → entier en unités mineures attendu par l'API.
 * `null` si vide ; `Number.NaN` si illisible, négatif ou trop précis pour la devise.
 */
export function lireMontant(v: string, devise: Devise): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0) return Number.NaN;
  const facteur = FACTEUR_MINEUR[devise];
  const mineur = Math.round(n * facteur);
  if (Math.abs(n * facteur - mineur) > 1e-6) return Number.NaN;
  if (!Number.isSafeInteger(mineur)) return Number.NaN;
  return mineur;
}

/** Montant de l'API (unités mineures) → unités usuelles (saisie ; l'affichage passe par `formaterMontantMineur`). */
export function montantUsuel(mineur: number | null | undefined, devise: Devise): number | null {
  if (mineur === null || mineur === undefined) return null;
  return mineur / FACTEUR_MINEUR[devise];
}

/** Montant de l'API → texte modifiable (« 150000 », « 1500,5 »). */
export function montantVersSaisie(mineur: number | null | undefined, devise: Devise): string {
  const usuel = montantUsuel(mineur, devise);
  return usuel === null ? "" : String(usuel).replace(".", ",");
}

/** Message d'aide sur la précision attendue d'un montant. */
export function aideMontant(devise: Devise): string {
  return FACTEUR_MINEUR[devise] === 1
    ? "Montant entier, sans décimale (ex. 150 000)."
    : "Deux décimales au plus (ex. 1 500,50).";
}

/** Supprime les clés dont la valeur est `undefined` (corps de modification partiel). */
export function sansIndefinis<T extends Record<string, unknown>>(objet: T): Partial<T> {
  return Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Résultat d'une validation : erreurs par champ, ou charge utile prête pour l'API. */
export type Resultat<C, K extends string = string> =
  { ok: true; charge: C } | { ok: false; erreurs: Partial<Record<K, string>> };
