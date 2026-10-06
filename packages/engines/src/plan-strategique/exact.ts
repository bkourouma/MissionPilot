/**
 * Arithmétique exacte du modèle financier.
 *
 * Les montants circulent en `bigint` d'unités mineures pendant le calcul ; les
 * taux (points de pourcentage, jours) sont convertis en fractions exactes par
 * `versRationnel` du domaine finance (écriture décimale la plus courte). Chaque
 * ligne d'un état est arrondie UNE fois, au plus proche, demi s'éloignant de
 * zéro (règle unique de `finance/calcul-exact.ts`). Les ratios exposés sont
 * arrondis à 4 décimales.
 */
import {
  ajouterRationnels,
  diviserArrondi,
  multiplierRationnels,
  ratio,
  versRationnel,
  type Rationnel,
} from "../finance/calcul-exact";
import { ErreurPlan } from "./erreurs";

export const UN: Rationnel = { num: 1n, den: 1n };

/** Convertit un `bigint` en `number` sans perte, sinon `MONTANT_INVALIDE`. */
export function versEntier(valeur: bigint): number {
  const resultat = Number(valeur);
  if (!Number.isSafeInteger(resultat)) {
    throw new ErreurPlan("MONTANT_INVALIDE", `Montant hors limites (${valeur}).`);
  }
  return resultat;
}

/** Fraction exacte d'un nombre déjà validé comme fini. */
export function fraction(x: number): Rationnel {
  return versRationnel(x);
}

/** `points` % sous forme de fraction : 18 → 18/100. */
export function pourcent(points: number): Rationnel {
  const r = versRationnel(points);
  return { num: r.num, den: r.den * 100n };
}

/** 1 + `points` % : 10 → 110/100. */
export function unPlus(points: number): Rationnel {
  const r = pourcent(points);
  return { num: r.den + r.num, den: r.den };
}

/** Puissance entière positive ou nulle d'une fraction. */
export function puissance(r: Rationnel, n: number): Rationnel {
  return { num: r.num ** BigInt(n), den: r.den ** BigInt(n) };
}

/** Montant × fraction, arrondi une fois au plus proche. */
export function appliquer(montant: bigint, r: Rationnel): bigint {
  return diviserArrondi(montant * r.num, r.den);
}

/** Produit de fractions. */
export function produit(...facteurs: readonly Rationnel[]): Rationnel {
  return facteurs.reduce(multiplierRationnels, UN);
}

/** a / b arrondi à 4 décimales, `null` si b = 0. */
export function ratioEntiers(a: bigint, b: bigint): number | null {
  return ratio({ num: a, den: 1n }, { num: b, den: 1n });
}

export function maximum(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minimum(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Signe d'un `bigint` : −1, 0 ou 1. */
export function signe(b: bigint): -1 | 0 | 1 {
  return b === 0n ? 0 : b < 0n ? -1 : 1;
}

/**
 * Somme exacte de deux nombres décimaux, rendue en `number` par son écriture
 * décimale : 10,1 + 0,2 = 10,3 (et non 10,299999999999999).
 */
export function sommeDecimale(a: number, b: number): number {
  const r = ajouterRationnels(versRationnel(a), versRationnel(b));
  // Le dénominateur est une puissance de 10 (écritures décimales).
  const decimales = r.den.toString().length - 1;
  const negatif = r.num < 0n;
  const chiffres = (negatif ? -r.num : r.num).toString().padStart(decimales + 1, "0");
  const texte = `${chiffres.slice(0, chiffres.length - decimales)}.${chiffres.slice(chiffres.length - decimales)}`;
  return Number(`${negatif ? "-" : ""}${texte}`);
}
