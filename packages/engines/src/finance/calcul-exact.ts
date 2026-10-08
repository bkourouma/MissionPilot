/**
 * Arithmétique exacte du domaine finance.
 *
 * Les montants sont des entiers d'unités mineures ; les facteurs (jours, taux,
 * pourcentages, taux de change) sont des `number` saisis en décimal. Pour ne
 * jamais propager une erreur de flottant, chaque facteur est converti en
 * fraction exacte (`Rationnel`) à partir de son écriture décimale la plus
 * courte (`String(0.18)` = "0.18" → 18/100), puis le calcul est fait en
 * `bigint` et arrondi une seule fois.
 *
 * Règle d'arrondi unique : à l'entier le plus proche, demi vers le haut en
 * valeur absolue (« demi s'éloignant de zéro ») : 2,5 → 3 ; −2,5 → −3.
 * Elle est symétrique, ce qui garantit qu'un avoir est l'exact opposé de la
 * facture qu'il annule.
 */
import { ErreurFinance } from "./erreurs";

/** Fraction exacte, dénominateur toujours strictement positif. */
export interface Rationnel {
  readonly num: bigint;
  readonly den: bigint;
}

function puissanceDix(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Convertit un `number` fini en fraction exacte de son écriture décimale. */
export function versRationnel(x: number, nom = "nombre"): Rationnel {
  if (!Number.isFinite(x)) {
    throw new ErreurFinance("NOMBRE_INVALIDE", `${nom} doit être un nombre fini (reçu ${x}).`);
  }
  const [mantisse = "0", exposantTexte] = String(x).toLowerCase().split("e");
  const exposant = exposantTexte === undefined ? 0 : Number(exposantTexte);
  const negatif = mantisse.startsWith("-");
  const [entier = "0", decimales = ""] = mantisse.replace("-", "").split(".");
  let num = BigInt(entier + decimales);
  let den = puissanceDix(decimales.length);
  if (exposant > 0) num *= puissanceDix(exposant);
  if (exposant < 0) den *= puissanceDix(-exposant);
  return { num: negatif ? -num : num, den };
}

export function multiplierRationnels(a: Rationnel, b: Rationnel): Rationnel {
  return { num: a.num * b.num, den: a.den * b.den };
}

export function ajouterRationnels(a: Rationnel, b: Rationnel): Rationnel {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

export function soustraireRationnels(a: Rationnel, b: Rationnel): Rationnel {
  return ajouterRationnels(a, { num: -b.num, den: b.den });
}

export function sommeRationnels(valeurs: readonly Rationnel[]): Rationnel {
  return valeurs.reduce(ajouterRationnels, { num: 0n, den: 1n });
}

/** Compare deux fractions : −1, 0 ou 1. */
export function comparerRationnels(a: Rationnel, b: Rationnel): -1 | 0 | 1 {
  const gauche = a.num * b.den;
  const droite = b.num * a.den;
  if (gauche === droite) return 0;
  return gauche < droite ? -1 : 1;
}

/** Division entière arrondie au plus proche, demi s'éloignant de zéro. */
export function diviserArrondi(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new ErreurFinance("NOMBRE_INVALIDE", "Division par zéro.");
  const negatif = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const quotient = a / b;
  const arrondi = 2n * (a % b) >= b ? quotient + 1n : quotient;
  return negatif ? -arrondi : arrondi;
}

/** Arrondit une fraction à l'entier (règle unique ci-dessus). */
export function arrondirRationnel(r: Rationnel): bigint {
  return diviserArrondi(r.num, r.den);
}

/** Convertit un entier `bigint` en `number`, en refusant toute perte. */
export function versEntierSur(valeur: bigint): number {
  const resultat = Number(valeur);
  if (!Number.isSafeInteger(resultat)) {
    throw new ErreurFinance("MONTANT_INVALIDE", `Montant hors limites (${valeur}).`);
  }
  return resultat;
}

/** Valeur décimale (affichage, jours) d'une fraction : division IEEE correctement arrondie. */
export function versNombre(r: Rationnel): number {
  return Number(r.num) / Number(r.den);
}

/**
 * Rapport a / b arrondi à 4 décimales (soit 0,01 %), ou `null` si b = 0.
 * Les taux ne sont pas des montants : ils sont rendus en `number` pour
 * l'affichage, après un arrondi exact.
 */
export function ratio(a: Rationnel, b: Rationnel): number | null {
  if (b.num === 0n) return null;
  const quotient = diviserArrondi(a.num * b.den * 10_000n, a.den * b.num);
  return Number(quotient) / 10_000;
}

/** Somme exacte de nombres décimaux (jours) : 0,1 + 0,2 = 0,3. */
export function sommeExacte(valeurs: readonly number[]): number {
  return versNombre(sommeRationnels(valeurs.map((v) => versRationnel(v))));
}

/** Différence exacte a − b de nombres décimaux (jours). */
export function differenceExacte(a: number, b: number): number {
  return versNombre(soustraireRationnels(versRationnel(a), versRationnel(b)));
}
