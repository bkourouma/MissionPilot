/**
 * Arithmétique exacte du pilotage par KPI.
 *
 * Les mesures, cibles, seuils et poids sont des `number` saisis en décimal ;
 * chacun est converti en fraction `bigint` réduite depuis son écriture
 * décimale la plus courte (`String(0.95)` = "0.95" → 19/20). Les seuils se
 * comparent sur ces valeurs exactes : 95 / 100 est exactement « vert », sans
 * bruit flottant. Arrondi de sortie unique : 4 décimales, demi s'éloignant de
 * zéro (même convention que `commun/ratio.ts`).
 *
 * Module interne au domaine (non exporté par `kpi/index.ts`) : chaque domaine
 * du paquet garde sa propre famille d'erreurs.
 */
import { ErreurKpi } from "./erreurs";

/** Fraction exacte réduite, dénominateur strictement positif. */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

export const ZERO: Fraction = { num: 0n, den: 1n };
export const UN: Fraction = { num: 1n, den: 1n };

function pgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function fraction(num: bigint, den: bigint = 1n): Fraction {
  if (den === 0n) throw new ErreurKpi("NOMBRE_INVALIDE", "Division par zéro.");
  const signe = den < 0n ? -1n : 1n;
  const g = pgcd(num, den);
  return { num: (signe * num) / g, den: (signe * den) / g };
}

/** Fraction exacte de l'écriture décimale d'un `number` fini. */
export function depuisNombre(x: number, nom = "nombre"): Fraction {
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new ErreurKpi("NOMBRE_INVALIDE", `${nom} doit être un nombre fini (reçu ${String(x)}).`);
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

export function entier(n: number): Fraction {
  return fraction(BigInt(n));
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

export function oppose(a: Fraction): Fraction {
  return { num: -a.num, den: a.den };
}

export function absolu(a: Fraction): Fraction {
  return a.num < 0n ? oppose(a) : a;
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

/** Arrondit à `decimales` décimales (demi s'éloignant de zéro) et rend un `number`. */
export function arrondir(a: Fraction, decimales = 4): number {
  const echelle = 10n ** BigInt(decimales);
  const n = a.num * echelle;
  const abs = n < 0n ? -n : n;
  let q = abs / a.den;
  if (2n * (abs % a.den) >= a.den) q += 1n;
  if (q === 0n) return 0;
  return ((n < 0n ? -1 : 1) * Number(q)) / Number(echelle);
}

/** Écriture « num/den » d'une fraction réduite : trace exacte, sérialisable en JSON. */
export function versTexte(a: Fraction): string {
  return a.den === 1n ? String(a.num) : `${a.num}/${a.den}`;
}
