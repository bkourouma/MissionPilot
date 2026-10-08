/**
 * Distance d'édition entre deux textes, comptée en MOTS (AGT-05).
 *
 * - Découpage : normalisation Unicode NFC, puis mots séparés par tout blanc
 *   Unicode ; la ponctuation reste attachée au mot (« marge, » ≠ « marge »).
 * - Levenshtein (insertion, suppression, substitution d'un mot : coût 1) et
 *   plus longue sous-suite commune (mots du brouillon conservés dans l'ordre),
 *   obtenue par la distance d'insertion-suppression : LCS = (n + m − d) / 2.
 * - Coût borné : préfixe et suffixe communs retirés d'abord (le cas courant
 *   d'une relecture), puis calcul dans une bande diagonale élargie par
 *   doublement (Ukkonen), exact dès que la distance tient dans la bande. Au-delà
 *   du budget de cellules, le résultat est une ESTIMATION PRUDENTE signalée
 *   (`exacte: false`) : distance majorée, mots conservés minorés (préfixe et
 *   suffixe communs seulement). Aucun coût quadratique non borné.
 */
import { ErreurContribution } from "./erreurs";

/** Nombre maximal de mots d'un texte comparé. */
export const MOTS_MAX_CONTRIBUTION = 100_000;

/** Budget de cellules de programmation dynamique par comparaison (toutes passes). */
export const CELLULES_MAX_CONTRIBUTION = 4_000_000;

const INFINI = 1_000_000_000;
const BANDE_INITIALE = 8;

export interface OptionsDistance {
  /** Budget de cellules (entier ≥ 1) ; défaut `CELLULES_MAX_CONTRIBUTION`. */
  readonly cellulesMax?: number;
}

export interface DistanceEdition {
  /** Distance de Levenshtein en mots (majorant si `exacte` est faux). */
  readonly distance: number;
  readonly exacte: boolean;
  readonly motsA: number;
  readonly motsB: number;
}

/** Découpe un texte en mots (NFC, séparateurs : blancs Unicode). */
export function decouperMots(texte: string): string[] {
  if (typeof texte !== "string") {
    throw new ErreurContribution("TEXTE_INVALIDE", "Texte attendu.");
  }
  const mots = texte
    .normalize("NFC")
    .split(/\s+/u)
    .filter((m) => m !== "");
  if (mots.length > MOTS_MAX_CONTRIBUTION) {
    throw new ErreurContribution(
      "TEXTE_TROP_LONG",
      `Texte trop long : ${MOTS_MAX_CONTRIBUTION} mots au plus.`,
    );
  }
  return mots;
}

export function cellulesMaxValide(options: OptionsDistance): number {
  const max = options.cellulesMax ?? CELLULES_MAX_CONTRIBUTION;
  if (!Number.isInteger(max) || max < 1) {
    throw new ErreurContribution("OPTIONS_INVALIDES", "Budget de cellules invalide.");
  }
  return max;
}

/** Retire le préfixe et le suffixe communs ; renvoie les cœurs et le nombre de mots communs retirés. */
function retirerCommuns(
  a: readonly string[],
  b: readonly string[],
): { a: readonly string[]; b: readonly string[]; communs: number } {
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut += 1;
  let fin = 0;
  while (
    fin < a.length - debut &&
    fin < b.length - debut &&
    a[a.length - 1 - fin] === b[b.length - 1 - fin]
  ) {
    fin += 1;
  }
  return {
    a: a.slice(debut, a.length - fin),
    b: b.slice(debut, b.length - fin),
    communs: debut + fin,
  };
}

/**
 * Distance dans la bande |i − j| ≤ k (substitution au coût donné) : exacte si
 * elle vaut au plus k (un chemin qui sort de la bande compte plus de k
 * insertions ou suppressions) ou si la bande couvre toute la matrice ; `null`
 * sinon.
 */
function distanceDansBande(
  a: readonly string[],
  b: readonly string[],
  coutSubstitution: number,
  k: number,
): number | null {
  const m = b.length;
  let precedente = new Int32Array(m + 1).fill(INFINI);
  let courante = new Int32Array(m + 1).fill(INFINI);
  for (let j = 0; j <= Math.min(m, k); j += 1) precedente[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const bas = Math.max(0, i - k);
    const haut = Math.min(m, i + k);
    if (bas > 0) courante[bas - 1] = INFINI;
    for (let j = bas; j <= haut; j += 1) {
      if (j === 0) {
        courante[0] = i;
        continue;
      }
      const substitution = precedente[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : coutSubstitution);
      courante[j] = Math.min(precedente[j]! + 1, courante[j - 1]! + 1, substitution);
    }
    [precedente, courante] = [courante, precedente];
  }
  const d = precedente[m]!;
  return d <= k || k >= Math.max(a.length, m) ? d : null;
}

/**
 * Distance bornée par le budget : `{ distance, exacte }`. Sans résultat exact
 * dans le budget, renvoie le majorant `majorant`.
 */
function distanceBornee(
  a: readonly string[],
  b: readonly string[],
  coutSubstitution: number,
  cellulesMax: number,
  majorant: number,
): { distance: number; exacte: boolean } {
  if (a.length === 0 || b.length === 0) return { distance: a.length + b.length, exacte: true };
  const complet = Math.max(a.length, b.length);
  let k = Math.max(Math.abs(a.length - b.length), BANDE_INITIALE);
  let depense = 0;
  for (;;) {
    const bande = Math.min(k, complet);
    const cellules = a.length * Math.min(2 * bande + 1, b.length + 1);
    if (depense + cellules > cellulesMax) return { distance: majorant, exacte: false };
    depense += cellules;
    const d = distanceDansBande(a, b, coutSubstitution, bande);
    if (d !== null) return { distance: d, exacte: true };
    k *= 2;
  }
}

/** Distance de Levenshtein en mots entre deux textes, au coût borné. */
export function distanceEditionMots(
  a: string,
  b: string,
  options: OptionsDistance = {},
): DistanceEdition {
  const cellulesMax = cellulesMaxValide(options);
  const motsA = decouperMots(a);
  const motsB = decouperMots(b);
  const r = distanceMots(motsA, motsB, cellulesMax);
  return { distance: r.distance, exacte: r.exacte, motsA: motsA.length, motsB: motsB.length };
}

/**
 * Mots de `a` conservés dans `b`, dans l'ordre (plus longue sous-suite
 * commune), au coût borné ; minorant si `exacte` est faux.
 */
export function motsConserves(
  motsA: readonly string[],
  motsB: readonly string[],
  cellulesMax: number,
): { conserves: number; exacte: boolean } {
  const coeurs = retirerCommuns(motsA, motsB);
  const majorant = coeurs.a.length + coeurs.b.length;
  const r = distanceBornee(coeurs.a, coeurs.b, 2, cellulesMax, majorant);
  return {
    conserves: coeurs.communs + (coeurs.a.length + coeurs.b.length - r.distance) / 2,
    exacte: r.exacte,
  };
}

/** Distance de Levenshtein sur des mots déjà découpés, au coût borné ; majorant si `exacte` est faux. */
export function distanceMots(
  motsA: readonly string[],
  motsB: readonly string[],
  cellulesMax: number,
): { distance: number; exacte: boolean } {
  const coeurs = retirerCommuns(motsA, motsB);
  return distanceBornee(
    coeurs.a,
    coeurs.b,
    1,
    cellulesMax,
    Math.max(coeurs.a.length, coeurs.b.length),
  );
}
