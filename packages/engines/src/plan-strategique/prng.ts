/**
 * Générateur pseudo-aléatoire à graine (PLA-16, simulation de Monte-Carlo).
 *
 * Exigence : mêmes paramètres + même graine = mêmes tirages, à l'octet près,
 * sur toute plateforme. Le module n'utilise donc ni `Math.random`, ni `Date`,
 * ni `Math.log`, `Math.exp`, `Math.cos`, `Math.sin` (dont les résultats ne
 * sont pas garantis identiques d'un moteur JavaScript à l'autre). Il ne repose
 * que sur l'arithmétique entière 32 bits (`Math.imul`, `>>> 0`), sur les
 * quatre opérations IEEE 754 (+, −, ×, ÷, exactes ou correctement arrondies)
 * et sur `Math.sqrt` (racine carrée correctement arrondie par IEEE 754).
 *
 * Algorithme :
 * - graine : entier 0 ≤ g ≤ 4 294 967 295 ;
 * - l'état de 128 bits est dérivé de la graine par splitmix32 (4 sorties
 *   successives), puis le générateur sfc32 (Small Fast Counting, Chris Doty-
 *   Humphrey) est avancé de 12 pas pour dissiper l'amorce ;
 * - période : sfc32 a un compteur de 32 bits ; la période moyenne est de
 *   l'ordre de 2^127 et la période minimale garantie de 2^32 (≈ 4,3 milliards),
 *   très au-delà des 2 000 tirages × 5 hypothèses d'une simulation ;
 * - `suivant()` renvoie `sortie32 / 2^32`, un multiple de 2^-32 dans [0, 1).
 *
 * Lois (u, u1…u12 : sorties indépendantes de `suivant()`) :
 * - uniforme(min, max) : x = min + u × (max − min) ;
 * - triangulaire(min, mode, max), par inversion de la fonction de
 *   répartition, avec c = (mode − min) / (max − min) :
 *   si u < c : x = min + √(u × (max − min) × (mode − min)),
 *   sinon    : x = max − √((1 − u) × (max − min) × (max − mode)) ;
 * - normale(moyenne, écart-type) tronquée à [min, max] : approximation de
 *   Irwin–Hall, z = (u1 + … + u12) − 6 (moyenne 0, variance exactement 1,
 *   somme exacte en virgule flottante), x = moyenne + écart-type × z. Les
 *   queues sont bornées à ±6 écarts-types. Troncature par rejet : tant que x
 *   sort de [min, max], on retire z, 50 essais au plus ; au 50ᵉ échec, le
 *   dernier x est ramené à la borne la plus proche (ce qui peut accumuler un
 *   peu de masse aux bornes quand elles sont très serrées).
 */
import { ErreurPlan } from "./erreurs";

/** Plus grande graine admise (entier non signé sur 32 bits). */
export const GRAINE_MAX = 4_294_967_295;

/** Nombre maximal d'essais de la troncature par rejet de la loi normale. */
export const ESSAIS_NORMALE_MAX = 50;

const DEUX_PUISSANCE_32 = 4_294_967_296;
const PAS_ECHAUFFEMENT = 12;

export interface GenerateurAlea {
  /** Prochain réel pseudo-aléatoire dans [0, 1). */
  suivant(): number;
}

/** Vérifie la graine : entier de 0 à 4 294 967 295. */
export function validerGraine(graine: number): void {
  if (!Number.isInteger(graine) || graine < 0 || graine > GRAINE_MAX) {
    throw new ErreurPlan(
      "MONTE_CARLO_INVALIDE",
      `La graine est un entier de 0 à ${GRAINE_MAX} (reçu ${String(graine)}).`,
      "graine",
    );
  }
}

/** splitmix32 : suite d'entiers non signés 32 bits à partir d'une graine. */
function splitmix32(graine: number): () => number {
  let s = graine | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Crée un générateur reproductible à partir d'une graine. */
export function creerGenerateur(graine: number): GenerateurAlea {
  validerGraine(graine);
  const amorce = splitmix32(graine);
  let a = amorce() | 0;
  let b = amorce() | 0;
  let c = amorce() | 0;
  let d = amorce() | 0;
  const pas = (): number => {
    const t0 = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const t = (t0 + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < PAS_ECHAUFFEMENT; i++) pas();
  return { suivant: () => pas() / DEUX_PUISSANCE_32 };
}

/** Tirage uniforme dans [min, max). */
export function tirerUniforme(g: GenerateurAlea, min: number, max: number): number {
  return min + g.suivant() * (max - min);
}

/** Tirage triangulaire sur [min, max] de mode `mode` (inversion de la répartition). */
export function tirerTriangulaire(
  g: GenerateurAlea,
  min: number,
  mode: number,
  max: number,
): number {
  const u = g.suivant();
  const largeur = max - min;
  const c = (mode - min) / largeur;
  if (u < c) return min + Math.sqrt(u * largeur * (mode - min));
  return max - Math.sqrt((1 - u) * largeur * (max - mode));
}

/**
 * Tirage normal tronqué à [min, max] (Irwin–Hall à 12 uniformes, rejet limité
 * à `ESSAIS_NORMALE_MAX` essais, puis ramené à la borne la plus proche).
 */
export function tirerNormale(
  g: GenerateurAlea,
  moyenne: number,
  ecartType: number,
  min: number,
  max: number,
): number {
  let x = moyenne;
  for (let essai = 0; essai < ESSAIS_NORMALE_MAX; essai++) {
    let somme = 0;
    for (let i = 0; i < 12; i++) somme += g.suivant();
    x = moyenne + ecartType * (somme - 6);
    if (x >= min && x <= max) return x;
  }
  return x < min ? min : max;
}
