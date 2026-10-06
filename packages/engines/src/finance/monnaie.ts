/**
 * Monnaie : montants en entiers d'unités mineures (FIN-04).
 *
 * - XOF et XAF (francs CFA) : 0 décimale, 1 500 000 FCFA → valeur 1500000.
 * - EUR et USD : 2 décimales, 1 234,50 € → valeur 123450.
 *
 * Toute multiplication (jours × taux, pourcentage, change) est exacte puis
 * arrondie une seule fois au plus proche, demi s'éloignant de zéro (voir
 * `calcul-exact.ts`). Deux montants de devises différentes ne s'additionnent
 * jamais : il faut d'abord convertir avec le taux figé à la signature.
 */
import {
  arrondirRationnel,
  comparerRationnels,
  multiplierRationnels,
  sommeRationnels,
  versEntierSur,
  versRationnel,
  type Rationnel,
} from "./calcul-exact";
import { joursDepuisEpoque, type DateIso } from "./dates";
import { ErreurFinance } from "./erreurs";

export type Devise = "XOF" | "XAF" | "EUR" | "USD";

export const DEVISES: readonly Devise[] = ["XOF", "XAF", "EUR", "USD"];

/** Nombre de décimales (unités mineures) par devise. */
export const DECIMALES_DEVISE: Readonly<Record<Devise, number>> = {
  XOF: 0,
  XAF: 0,
  EUR: 2,
  USD: 2,
};

/** Symbole d'affichage fr-FR. XOF et XAF s'affichent tous deux « FCFA ». */
export const SYMBOLE_DEVISE: Readonly<Record<Devise, string>> = {
  XOF: "FCFA",
  XAF: "FCFA",
  EUR: "€",
  USD: "$US",
};

/** Parité fixe légale : 1 EUR = 655,957 XOF (et XAF). */
export const PARITE_EUR_FCFA = 655.957;

/** Montant en unités mineures entières. */
export interface Montant {
  readonly valeur: number;
  readonly devise: Devise;
}

/** Taux de change figé : 1 unité de `source` = `taux` unités de `cible` (FIN-04). */
export interface TauxChange {
  readonly source: Devise;
  readonly cible: Devise;
  readonly taux: number;
  readonly dateFixation: DateIso;
}

/** Construit un montant ; refuse une valeur non entière ou hors limites. */
export function montant(valeur: number, devise: Devise): Montant {
  if (!Number.isSafeInteger(valeur)) {
    throw new ErreurFinance(
      "MONTANT_INVALIDE",
      `Un montant est un entier d'unités mineures (reçu ${valeur} ${devise}).`,
    );
  }
  return { valeur, devise };
}

export function zero(devise: Devise): Montant {
  return montant(0, devise);
}

/**
 * Montant depuis une saisie décimale en unités majeures : 1234.5 EUR → 123450.
 * Refuse une saisie plus précise que la devise (1234.567 EUR) plutôt que
 * d'arrondir en silence.
 */
export function montantDepuisDecimal(valeurDecimale: number, devise: Devise): Montant {
  const r = multiplierRationnels(versRationnel(valeurDecimale, "montant"), {
    num: 10n ** BigInt(DECIMALES_DEVISE[devise]),
    den: 1n,
  });
  if (r.num % r.den !== 0n) {
    throw new ErreurFinance(
      "MONTANT_INVALIDE",
      `${valeurDecimale} a trop de décimales pour ${devise} (${DECIMALES_DEVISE[devise]} au plus).`,
    );
  }
  return montant(versEntierSur(r.num / r.den), devise);
}

/** Refuse deux devises différentes. */
export function verifierMemeDevise(a: Montant, b: Montant): void {
  if (a.devise !== b.devise) {
    throw new ErreurFinance(
      "DEVISE_DIFFERENTE",
      `Opération impossible entre ${a.devise} et ${b.devise} : convertir d'abord.`,
    );
  }
}

export function additionner(a: Montant, b: Montant): Montant {
  verifierMemeDevise(a, b);
  return montant(a.valeur + b.valeur, a.devise);
}

export function soustraire(a: Montant, b: Montant): Montant {
  verifierMemeDevise(a, b);
  return montant(a.valeur - b.valeur, a.devise);
}

/** Somme d'une liste ; une liste vide vaut zéro dans `devise`. */
export function sommer(montants: readonly Montant[], devise: Devise): Montant {
  return montants.reduce((total, m) => additionner(total, m), zero(devise));
}

export function oppose(m: Montant): Montant {
  return montant(m.valeur === 0 ? 0 : -m.valeur, m.devise);
}

/** Compare deux montants de même devise : −1, 0 ou 1. */
export function comparer(a: Montant, b: Montant): -1 | 0 | 1 {
  verifierMemeDevise(a, b);
  return a.valeur === b.valeur ? 0 : a.valeur < b.valeur ? -1 : 1;
}

/** Multiplie par une fraction exacte, arrondi au plus proche (demi loin de zéro). */
export function multiplierParRationnel(m: Montant, facteur: Rationnel): Montant {
  const produit = multiplierRationnels({ num: BigInt(m.valeur), den: 1n }, facteur);
  return montant(versEntierSur(arrondirRationnel(produit)), m.devise);
}

/**
 * Multiplie par un nombre de jours ou un taux décimal.
 * Exemple : 2,5 j × 350 000 FCFA = 875 000 FCFA ; 0,5 j × 333,33 € = 166,67 €
 * (16 666,5 centimes arrondis à 16 667).
 */
export function multiplier(m: Montant, facteur: number): Montant {
  return multiplierParRationnel(m, versRationnel(facteur, "facteur"));
}

/** Applique un pourcentage exprimé en points (18 pour 18 %). */
export function appliquerPourcentage(m: Montant, pourcentage: number): Montant {
  const r = versRationnel(pourcentage, "pourcentage");
  return multiplierParRationnel(m, { num: r.num, den: r.den * 100n });
}

function validerPoids(poids: readonly number[]): Rationnel[] {
  if (poids.length === 0) {
    throw new ErreurFinance("REPARTITION_INVALIDE", "Au moins une part est requise.");
  }
  const rationnels = poids.map((p) => versRationnel(p, "poids"));
  const total = sommeRationnels(rationnels);
  if (rationnels.some((r) => r.num < 0n) || total.num === 0n) {
    throw new ErreurFinance(
      "REPARTITION_INVALIDE",
      "Les poids doivent être positifs, de somme non nulle.",
    );
  }
  return rationnels;
}

/**
 * Répartit un montant selon des poids (pourcentages, jours…) sans perdre une
 * unité mineure : chaque part sauf la dernière est tronquée vers zéro, et la
 * dernière reçoit le reste. La somme des parts égale toujours le total.
 * Exemple : 100 FCFA en 3 parts égales → 33, 33, 34.
 */
export function repartir(total: Montant, poids: readonly number[]): Montant[] {
  const rationnels = validerPoids(poids);
  const somme = sommeRationnels(rationnels);
  const parts = rationnels.slice(0, -1).map((r) => {
    const num = BigInt(total.valeur) * r.num * somme.den;
    return montant(versEntierSur(num / (r.den * somme.num)), total.devise);
  });
  const dejaReparti = parts.reduce((s, p) => s + p.valeur, 0);
  return [...parts, montant(total.valeur - dejaReparti, total.devise)];
}

/** Répartit en `n` parts égales (le reste va à la dernière). */
export function repartirEgalement(total: Montant, n: number): Montant[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new ErreurFinance("REPARTITION_INVALIDE", `Nombre de parts invalide (${n}).`);
  }
  return repartir(
    total,
    Array.from({ length: n }, () => 1),
  );
}

/** Crée un taux de change figé (à la signature) après validation. */
export function figerTauxChange(
  source: Devise,
  cible: Devise,
  taux: number,
  dateFixation: DateIso,
): TauxChange {
  joursDepuisEpoque(dateFixation);
  if (comparerRationnels(versRationnel(taux, "taux de change"), { num: 0n, den: 1n }) <= 0) {
    throw new ErreurFinance(
      "TAUX_CHANGE_INVALIDE",
      `Le taux de change doit être positif (reçu ${taux}).`,
    );
  }
  if (source === cible && taux !== 1) {
    throw new ErreurFinance("TAUX_CHANGE_INVALIDE", `Le taux ${source}→${cible} vaut 1.`);
  }
  return Object.freeze({ source, cible, taux, dateFixation });
}

/**
 * Convertit avec un taux figé. Exemple : 1 000,00 € (100000 centimes) au taux
 * 655,957 → 100000 × 655,957 × 10^(0 − 2) = 655 957 FCFA.
 */
export function convertir(m: Montant, taux: TauxChange): Montant {
  if (m.devise !== taux.source) {
    throw new ErreurFinance(
      "TAUX_CHANGE_INVALIDE",
      `Le taux ${taux.source}→${taux.cible} ne s'applique pas à un montant en ${m.devise}.`,
    );
  }
  const ecart = DECIMALES_DEVISE[taux.cible] - DECIMALES_DEVISE[taux.source];
  const echelle: Rationnel =
    ecart >= 0 ? { num: 10n ** BigInt(ecart), den: 1n } : { num: 1n, den: 10n ** BigInt(-ecart) };
  const facteur = multiplierRationnels(versRationnel(taux.taux, "taux de change"), echelle);
  const converti = multiplierParRationnel(m, facteur);
  return montant(converti.valeur, taux.cible);
}

/** Espace fine insécable (séparateur de milliers fr-FR, comme Intl). */
export const ESPACE_FINE_INSECABLE = " ";
/** Espace insécable (avant le symbole monétaire). */
export const ESPACE_INSECABLE = " ";

function grouperMilliers(chiffres: string): string {
  return chiffres.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE_INSECABLE);
}

/**
 * Formatage d'affichage fr-FR, déterministe (indépendant de l'ICU du serveur) :
 * « 1 500 000 FCFA », « 1 234,50 € », « -12,00 $US ». Milliers séparés par une
 * espace fine insécable (U+202F), symbole précédé d'une espace insécable (U+00A0).
 */
export function formaterMontant(m: Montant): string {
  const decimales = DECIMALES_DEVISE[m.devise];
  const chiffres = String(Math.abs(m.valeur)).padStart(decimales + 1, "0");
  const entier = chiffres.slice(0, chiffres.length - decimales);
  const fraction = decimales > 0 ? `,${chiffres.slice(-decimales)}` : "";
  const signe = m.valeur < 0 ? "-" : "";
  return `${signe}${grouperMilliers(entier)}${fraction}${ESPACE_INSECABLE}${SYMBOLE_DEVISE[m.devise]}`;
}
