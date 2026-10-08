/**
 * Géométrie des graphiques de notation (radar de maturité, barres par dimension). Logique pure,
 * testée dans `notation-graphiques.test.ts`.
 *
 * Il s'agit de placer à l'écran des scores DÉJÀ calculés par l'API (0 à 100) : coordonnées SVG,
 * longueurs de barres. Aucun score, aucune classe ni aucun écart n'est calculé ici.
 */

export interface AxeRadarEntree {
  dimension: string;
  axe: string;
  score: number | null;
}

export interface AxeRadar {
  dimension: string;
  libelle: string;
  /** Numéro affiché au bout de l'axe (renvoie à la légende numérotée). */
  numero: number;
  score: number | null;
  /** Extrémité de l'axe (score 100). */
  x: number;
  y: number;
  /** Position du numéro, un peu au-delà de l'extrémité. */
  xNumero: number;
  yNumero: number;
  /** Point du score ; null pour une dimension non notable. */
  point: { x: number; y: number } | null;
}

export interface GeometrieRadar {
  taille: number;
  centre: number;
  rayon: number;
  /** Anneaux aux seuils des classes (35, 50, 65, 80) et à 100. */
  anneaux: { valeur: number; points: string; yLibelle: number }[];
  axes: AxeRadar[];
  /** Polygone des dimensions notables (au moins trois), sinon null. */
  polygone: string | null;
  /** Nombre d'axes non notables (non tracés). */
  nonNotables: number;
}

/** Seuils des classes A–E (DECISIONS.md) : repères visuels seulement. */
export const SEUILS_CLASSES = [35, 50, 65, 80] as const;
const ANNEAUX = [...SEUILS_CLASSES, 100];

const arrondi = (v: number) => Math.round(v * 100) / 100;

const scoreBorne = (s: number) => Math.min(100, Math.max(0, s));

/** Coordonnées d'une valeur 0–100 sur l'axe `i` parmi `n` (premier axe vers le haut). */
function position(centre: number, rayon: number, i: number, n: number, valeur: number) {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
  const r = (rayon * scoreBorne(valeur)) / 100;
  return { x: arrondi(centre + r * Math.cos(angle)), y: arrondi(centre + r * Math.sin(angle)) };
}

const texte = (points: readonly { x: number; y: number }[]) =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

export function geometrieRadar(entrees: readonly AxeRadarEntree[], taille = 320): GeometrieRadar {
  const centre = taille / 2;
  const rayon = arrondi(taille / 2 - 28);
  const n = entrees.length;
  const axes: AxeRadar[] = entrees.map((e, i) => {
    const bout = position(centre, rayon, i, n, 100);
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const valide = e.score !== null && Number.isFinite(e.score);
    return {
      dimension: e.dimension,
      libelle: e.axe,
      numero: i + 1,
      score: valide ? e.score : null,
      x: bout.x,
      y: bout.y,
      xNumero: arrondi(centre + (rayon + 16) * Math.cos(angle)),
      yNumero: arrondi(centre + (rayon + 16) * Math.sin(angle)),
      point: valide ? position(centre, rayon, i, n, e.score as number) : null,
    };
  });
  const notables = axes.flatMap((a) => (a.point ? [a.point] : []));
  return {
    taille,
    centre,
    rayon,
    anneaux:
      n >= 3
        ? ANNEAUX.map((v) => ({
            valeur: v,
            points: texte(entrees.map((_, i) => position(centre, rayon, i, n, v))),
            yLibelle: arrondi(centre - (rayon * v) / 100),
          }))
        : [],
    axes,
    polygone: notables.length >= 3 ? texte(notables) : null,
    nonNotables: axes.length - notables.length,
  };
}

/** Longueur d'une barre en pourcentage de la piste (score 0–100 de l'API, borné). */
export function longueurBarre(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "0%";
  return `${arrondi(scoreBorne(score))}%`;
}
