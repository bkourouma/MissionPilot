/**
 * Tendance d'une série de valeurs périodiques (KPI-03, KPI-08 déterministe).
 *
 * La série est indexée par période (position 0, 1, 2…) ; `null` marque une
 * période non mesurée, qui reste à sa place sans fausser l'écart entre
 * périodes. Sur la fenêtre retenue (les `fenetre` dernières positions, toute
 * la série par défaut), on ajuste une droite des moindres carrés, en
 * arithmétique exacte :
 * - variation = pente × (position de la dernière mesure − position de la première) ;
 * - référence = |moyenne des valeurs mesurées de la fenêtre| ;
 * - stable si |variation| ≤ max(toleranceRelative × référence, toleranceAbsolue),
 *   sinon hausse ou baisse selon le signe de la pente.
 * L'évolution traduit la direction selon le sens de lecture : une hausse est
 * une amélioration si « plus haut = mieux », une dégradation sinon.
 * Moins de deux mesures : tendance « indeterminee ».
 */
import { ErreurKpi } from "./erreurs";
import type { SensLectureKpi } from "./atteinte";
import {
  ZERO,
  absolu,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  entier,
  estNul,
  multiplier,
  somme,
  soustraire,
  type Fraction,
} from "./fraction";

export type DirectionKpi = "hausse" | "baisse" | "stable" | "indeterminee";
export type EvolutionKpi = "amelioration" | "degradation" | "stable" | "indeterminee";

export const TOLERANCE_TENDANCE_KPI_DEFAUT = 0.02;

export interface OptionsTendanceKpi {
  /** Part de la référence en deçà de laquelle la variation est « stable » (défaut 0,02). */
  readonly toleranceRelative?: number;
  /** Variation absolue tolérée (défaut 0), utile quand la moyenne est proche de zéro. */
  readonly toleranceAbsolue?: number;
  /** Nombre de dernières périodes examinées (entier ≥ 2) ; défaut : toute la série. */
  readonly fenetre?: number;
}

export interface TendanceKpi {
  readonly direction: DirectionKpi;
  readonly evolution: EvolutionKpi;
  /** Pente par période, 4 décimales. */
  readonly pente: number | null;
  /** Variation ajustée sur la fenêtre, 4 décimales. */
  readonly variation: number | null;
  /** Variation / |moyenne|, 4 décimales ; `null` si la moyenne est nulle. */
  readonly variationRelative: number | null;
  /** Nombre de mesures retenues. */
  readonly points: number;
}

export interface PointExact {
  readonly x: Fraction;
  readonly y: Fraction;
}

/** Droite des moindres carrés exacte ; `null` si les abscisses sont toutes égales. */
export function regressionExacte(
  points: readonly PointExact[],
): { readonly pente: Fraction; readonly ordonnee: Fraction } | null {
  const n = entier(points.length);
  const sx = somme(points.map((p) => p.x));
  const sy = somme(points.map((p) => p.y));
  const sxy = somme(points.map((p) => multiplier(p.x, p.y)));
  const sxx = somme(points.map((p) => multiplier(p.x, p.x)));
  const denominateur = soustraire(multiplier(n, sxx), multiplier(sx, sx));
  if (estNul(denominateur)) return null;
  const pente = diviser(soustraire(multiplier(n, sxy), multiplier(sx, sy)), denominateur);
  const ordonnee = diviser(soustraire(sy, multiplier(pente, sx)), n);
  return { pente, ordonnee };
}

export function toleranceKpi(valeur: number | undefined, defaut: number, nom: string): Fraction {
  const t = depuisNombre(valeur ?? defaut, nom);
  if (comparer(t, ZERO) < 0) {
    throw new ErreurKpi("OPTIONS_INVALIDES", `${nom} doit être positive ou nulle.`);
  }
  return t;
}

function fenetreDe(
  valeurs: readonly (number | null)[],
  fenetre: number | undefined,
): readonly (number | null)[] {
  if (fenetre === undefined) return valeurs;
  if (!Number.isSafeInteger(fenetre) || fenetre < 2) {
    throw new ErreurKpi("OPTIONS_INVALIDES", "La fenêtre de tendance est un entier ≥ 2.");
  }
  return valeurs.slice(-fenetre);
}

function evolutionDe(direction: DirectionKpi, sens: SensLectureKpi): EvolutionKpi {
  if (direction === "stable" || direction === "indeterminee") return direction;
  return (direction === "hausse") === (sens === "plus_haut_mieux") ? "amelioration" : "degradation";
}

/** Tendance d'une série périodique, orientée par le sens de lecture du KPI. */
export function tendanceKpi(
  valeurs: readonly (number | null)[],
  sens: SensLectureKpi,
  options: OptionsTendanceKpi = {},
): TendanceKpi {
  const tolRel = toleranceKpi(
    options.toleranceRelative,
    TOLERANCE_TENDANCE_KPI_DEFAUT,
    "La tolérance relative",
  );
  const tolAbs = toleranceKpi(options.toleranceAbsolue, 0, "La tolérance absolue");
  const points: PointExact[] = [];
  fenetreDe(valeurs, options.fenetre).forEach((v, i) => {
    if (v !== null) points.push({ x: entier(i), y: depuisNombre(v, `La valeur ${i + 1}`) });
  });
  const droite = points.length < 2 ? null : regressionExacte(points);
  if (droite === null) {
    const nul = { pente: null, variation: null, variationRelative: null };
    return { direction: "indeterminee", evolution: "indeterminee", ...nul, points: points.length };
  }
  const etendue = soustraire(
    (points[points.length - 1] as PointExact).x,
    (points[0] as PointExact).x,
  );
  const variation = multiplier(droite.pente, etendue);
  const reference = absolu(diviser(somme(points.map((p) => p.y)), entier(points.length)));
  const seuilRelatif = multiplier(tolRel, reference);
  const seuil = comparer(seuilRelatif, tolAbs) >= 0 ? seuilRelatif : tolAbs;
  const stable = comparer(absolu(variation), seuil) <= 0;
  const direction: DirectionKpi = stable ? "stable" : variation.num > 0n ? "hausse" : "baisse";
  return {
    direction,
    evolution: evolutionDe(direction, sens),
    pente: arrondir(droite.pente),
    variation: arrondir(variation),
    variationRelative: estNul(reference) ? null : arrondir(diviser(variation, reference)),
    points: points.length,
  };
}
