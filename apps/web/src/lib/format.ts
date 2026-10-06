/**
 * Formatage d'affichage en fr-FR. Ces fonctions mettent en forme des valeurs déjà calculées
 * (par l'API et ses moteurs) : elles ne calculent aucun chiffre métier.
 *
 * Les séparateurs sont insécables : espace fine insécable (U+202F) entre les milliers,
 * espace insécable (U+00A0) avant l'unité, pour qu'un montant ne soit jamais coupé en fin de ligne.
 */

export const DEVISES = ["XOF", "XAF", "EUR", "USD"] as const;
export type Devise = (typeof DEVISES)[number];

/** Affiché quand la valeur est absente ou invalide. */
export const VALEUR_ABSENTE = "—";

const NBSP = "\u00a0";

const SYMBOLES: Record<Devise, string> = { XOF: "FCFA", XAF: "FCFA", EUR: "€", USD: "$US" };
/** Le franc CFA n'a pas de subdivision en usage. */
const DECIMALES: Record<Devise, number> = { XOF: 0, XAF: 0, EUR: 2, USD: 2 };

function nombreValide(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 1500000 → « 1 500 000 », 2.5 → « 2,5 » (au plus `decimalesMax` décimales). */
export function formaterNombre(valeur: number | null | undefined, decimalesMax = 2): string {
  if (!nombreValide(valeur)) return VALEUR_ABSENTE;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: decimalesMax }).format(valeur);
}

/** « 1 500 000 FCFA », « 1 500,50 € », « 1 500,50 $US ». */
export function formaterMontant(valeur: number | null | undefined, devise: Devise = "XOF"): string {
  if (!nombreValide(valeur)) return VALEUR_ABSENTE;
  const decimales = DECIMALES[devise];
  const nombre = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valeur);
  return `${nombre}${NBSP}${SYMBOLES[devise]}`;
}

/** Durées en jours de travail : 2.5 → « 2,5 j », 1 → « 1 j ». */
export function formaterJours(valeur: number | null | undefined): string {
  if (!nombreValide(valeur)) return VALEUR_ABSENTE;
  return `${formaterNombre(valeur, 2)}${NBSP}j`;
}

/** Ratio 0..1 → « 12,5 % ». */
export function formaterPourcentage(ratio: number | null | undefined, decimalesMax = 1): string {
  if (!nombreValide(ratio)) return VALEUR_ABSENTE;
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: decimalesMax,
  }).format(ratio);
}

const DATE_SEULE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Convertit une entrée en Date ; une date seule « AAAA-MM-JJ » est lue en UTC (pas de décalage). */
export function lireDate(valeur: Date | string | null | undefined): Date | null {
  if (valeur == null || valeur === "") return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  const m = DATE_SEULE.exec(valeur);
  const date = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    : new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * « 12 janv. 2027 ». `fuseau` vaut UTC par défaut : les dates métier (échéances, périodes)
 * sont des jours calendaires, pas des instants.
 */
export function formaterDate(valeur: Date | string | null | undefined, fuseau = "UTC"): string {
  const date = lireDate(valeur);
  if (!date) return VALEUR_ABSENTE;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: fuseau,
  }).format(date);
}

/** « 12 janv. 2027 à 14:05 », dans le fuseau donné. */
export function formaterDateHeure(
  valeur: Date | string | null | undefined,
  fuseau = "Africa/Abidjan",
): string {
  const date = lireDate(valeur);
  if (!date) return VALEUR_ABSENTE;
  const jour = formaterDate(date, fuseau);
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fuseau,
  }).format(date);
  return `${jour} à ${heure}`;
}
