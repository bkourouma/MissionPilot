/**
 * Arithmétique exacte de la notation.
 *
 * Tout calcul intermédiaire (points d'un indicateur, moyennes pondérées,
 * normalisation des poids) se fait en fractions `bigint` réduites, construites
 * depuis l'écriture décimale la plus courte des nombres saisis
 * (`String(0.1)` = "0.1" → 1/10). Aucun flottant ne s'accumule : le même
 * calcul rend toujours le même résultat, quel que soit l'ordre des termes.
 *
 * Arrondi de sortie unique : à 1 décimale, demi s'éloignant de zéro
 * (62,25 → 62,3 ; −0,05 → −0,1).
 */
import { ErreurNotation } from "./erreurs";

/** Fraction exacte réduite, dénominateur strictement positif. */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

export const ZERO: Fraction = { num: 0n, den: 1n };
export const CENT: Fraction = { num: 100n, den: 1n };

function pgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function fraction(num: bigint, den: bigint = 1n): Fraction {
  if (den === 0n) throw new ErreurNotation("NOMBRE_INVALIDE", "Division par zéro.");
  const signe = den < 0n ? -1n : 1n;
  const g = pgcd(num, den < 0n ? -den : den);
  return { num: (signe * num) / g, den: (signe * den) / g };
}

/** Fraction exacte de l'écriture décimale d'un `number` fini. */
export function depuisNombre(x: number, nom = "nombre"): Fraction {
  if (!Number.isFinite(x)) {
    throw new ErreurNotation("NOMBRE_INVALIDE", `${nom} doit être un nombre fini (reçu ${x}).`);
  }
  const [mantisse = "0", exposantTexte] = String(x).toLowerCase().split("e");
  const exposant = exposantTexte === undefined ? 0 : Number(exposantTexte);
  const negatif = mantisse.startsWith("-");
  const [entier = "0", decimales = ""] = mantisse.replace("-", "").split(".");
  let num = BigInt(entier + decimales);
  let den = 10n ** BigInt(decimales.length);
  if (exposant > 0) num *= 10n ** BigInt(exposant);
  if (exposant < 0) den *= 10n ** BigInt(-exposant);
  return fraction(negatif ? -num : num, den);
}

export function ajouter(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function soustraire(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function multiplier(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.num, a.den * b.den);
}

export function diviser(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den, a.den * b.num);
}

export function somme(valeurs: readonly Fraction[]): Fraction {
  return valeurs.reduce(ajouter, ZERO);
}

/** −1, 0 ou 1. */
export function comparer(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const g = a.num * b.den;
  const d = b.num * a.den;
  if (g === d) return 0;
  return g < d ? -1 : 1;
}

export function estNul(a: Fraction): boolean {
  return a.num === 0n;
}

/** Borne `a` dans [min, max]. */
export function borner(a: Fraction, min: Fraction, max: Fraction): Fraction {
  if (comparer(a, min) < 0) return min;
  if (comparer(a, max) > 0) return max;
  return a;
}

/** Arrondit à `decimales` décimales (demi s'éloignant de zéro) et rend un `number`. */
export function arrondir(a: Fraction, decimales = 1): number {
  const echelle = 10n ** BigInt(decimales);
  const n = a.num * echelle;
  const absolu = n < 0n ? -n : n;
  let q = absolu / a.den;
  if (2n * (absolu % a.den) >= a.den) q += 1n;
  const signe = n < 0n && q !== 0n ? -1 : 1;
  return (signe * Number(q)) / Number(echelle);
}

/** Écriture « num/den » d'une fraction réduite : trace exacte, sérialisable en JSON. */
export function versTexte(a: Fraction): string {
  return a.den === 1n ? String(a.num) : `${a.num}/${a.den}`;
}

/** Relit une écriture produite par `versTexte`. */
export function depuisTexte(texte: string): Fraction {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(texte);
  if (m === null) {
    throw new ErreurNotation("NOMBRE_INVALIDE", `Fraction illisible : « ${texte} ».`);
  }
  return fraction(BigInt(m[1] as string), BigInt(m[2] ?? "1"));
}
