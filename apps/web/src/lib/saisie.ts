/**
 * Lecture des saisies de formulaire (sans React), testée dans `saisie.test.ts`.
 * Ces fonctions convertissent un texte saisi en valeur ; elles ne calculent aucun chiffre métier.
 */
import type { Langue } from "@missionpilot/shared";
import type { Devise } from "./format";
import { langueNavigateur } from "./langue-navigateur";

export const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Texte saisi → chaîne nettoyée, ou `null` si vide. */
export function texteOuNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

/** Groupes de milliers à l'anglaise : « 1,500 », « -1,250,000.75 », « 15,5 % » exclu. */
const MILLIERS_ANGLAIS = /^[^\d,]*\d{1,3}(,\d{3})+(\.\d+)?[^\d,]*$/;

/**
 * Normalise un nombre saisi (sans espaces, point décimal) selon la langue de l'interface.
 * - français : la virgule est le séparateur décimal (« 1 500,5 » → « 1500.5 ») ;
 * - anglais : la virgule ne sépare que des milliers (« 1,500.5 » → « 1500.5 ») ; toute autre
 *   virgule est laissée telle quelle pour que la lecture échoue (« 2,5 » est refusé, jamais
 *   lu comme 2,5 ou 25), afin qu'un montant ne soit jamais mal interprété en silence.
 * `\s` couvre aussi les espaces insécables (U+00A0, U+202F) des nombres copiés-collés.
 */
export function normaliserNombreSaisi(v: string, langue: Langue = langueNavigateur()): string {
  const sansEspaces = v.replace(/\s/g, "");
  if (langue === "en") {
    return MILLIERS_ANGLAIS.test(sansEspaces) ? sansEspaces.replace(/,/g, "") : sansEspaces;
  }
  return sansEspaces.replace(",", ".");
}

/**
 * Nombre saisi : « 2,5 », « 1 500 », « 1 500,5 » en français ; « 2.5 », « 1,500.5 » en
 * anglais (langue du navigateur par défaut). `null` si vide, `Number.NaN` si illisible.
 */
export function lireNombre(v: string, langue: Langue = langueNavigateur()): number | null {
  const brut = normaliserNombreSaisi(v, langue);
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
export function aideMontant(devise: Devise, langue: Langue = "fr"): string {
  if (langue === "en") {
    return FACTEUR_MINEUR[devise] === 1
      ? "Whole amount, no decimals (e.g. 150,000)."
      : "Up to two decimals (e.g. 1,500.50).";
  }
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
