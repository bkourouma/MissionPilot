import { z } from "zod";

export const DEVISES = ["XOF", "XAF", "EUR", "USD"] as const;
export type Devise = (typeof DEVISES)[number];
export const deviseSchema = z.enum(DEVISES);

/** Code pays ISO 3166-1 alpha-2 (ex. CI, SN, BF). */
export const paysSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Code pays ISO à deux lettres attendu.");

/** Texte obligatoire, espaces de bord retirés. */
export const texte = (max: number) => z.string().trim().min(1).max(max);

/** Texte facultatif : chaîne vide ou absente → null. */
export const texteOptionnel = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const emailOptionnel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  emailSchema.nullable().optional(),
);

/** Date calendaire AAAA-MM-JJ valide. */
export const dateIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ attendue.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide.");

/**
 * Date calendaire valide ET comprise entre 2000-01-01 et 2100-12-31 : l'intervalle des CHECK
 * SQL des colonnes de dates métier (échéances, observations). Évite un 500 sur une date
 * valide mais hors bornes (SQLSTATE 23514).
 */
export const dateIsoBorneeSchema = dateIsoSchema.refine(
  (v) => v >= "2000-01-01" && v <= "2100-12-31",
  "Date comprise entre 2000 et 2100 attendue.",
);

/** Montant en unités mineures entières (FCFA : 1 unité ; EUR/USD : centimes). */
export const montantSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Code technique stable : minuscules, chiffres, tiret bas. */
export const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,40}$/, "Code : minuscules, chiffres et tiret bas, 40 caractères au plus.");

/** Liste de libellés courts sans doublon (compétences, secteurs, langues). */
export const listeLibelles = (maxElements = 50, maxLongueur = 80) =>
  z
    .array(texte(maxLongueur))
    .max(maxElements)
    .transform((liste) => [...new Set(liste)]);

/** Exige au moins un champ renseigné dans un corps de modification. */
export function auMoinsUnChamp<T extends Record<string, unknown>>(v: T): boolean {
  return Object.values(v).some((x) => x !== undefined);
}
export const MESSAGE_CORPS_VIDE = "Au moins un champ à modifier est attendu.";
