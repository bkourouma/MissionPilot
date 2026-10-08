/**
 * Géométrie du graphique de série d'un KPI (valeur et cible par période). Logique pure,
 * testée dans `kpi-graphiques.test.ts`.
 *
 * Il s'agit de PLACER à l'écran des valeurs déjà calculées par l'API (agrégation par période,
 * cible versionnée, statut du moteur) : échelle, graduations, coordonnées SVG. Aucun chiffre
 * métier n'est calculé ici ; le tableau qui accompagne le graphique porte toutes les valeurs.
 */
import type { StatutKpi } from "./kpi";

export interface PointSerieEntree {
  periode: string;
  valeur: number | null;
  cible: number | null;
  statut: StatutKpi;
  /** Période close (sinon : période en cours, réalisé partiel). */
  close: boolean;
}

export interface PointSerie {
  periode: string;
  x: number;
  y: number;
  valeur: number;
  statut: StatutKpi;
  close: boolean;
}

export interface GeometrieSerie {
  largeur: number;
  hauteur: number;
  zone: { gauche: number; droite: number; haut: number; bas: number };
  /** Graduations de l'axe des valeurs, du bas vers le haut. */
  graduations: { valeur: number; y: number; libelle: string }[];
  /** Une abscisse par période ; `libelle` null quand il est omis faute de place. */
  abscisses: { periode: string; x: number; libelle: string | null }[];
  /** Tracés (attribut `points` d'une polyline) de la valeur, coupés aux périodes non mesurées. */
  traitsValeur: string[];
  /** Tracés de la cible, coupés aux périodes sans cible. */
  traitsCible: string[];
  points: PointSerie[];
  /** Aucune valeur ni cible à placer : le graphique n'a rien à montrer. */
  vide: boolean;
}

export interface OptionsGeometrie {
  largeur?: number;
  hauteur?: number;
  /** Nombre maximal de libellés d'abscisse affichés. */
  maxLibelles?: number;
  libellePeriode?: (cle: string) => string;
  libelleValeur?: (v: number) => string;
}

const arrondi = (v: number) => Math.round(v * 100) / 100;
/** Supprime le bruit binaire (0.1 + 0.2) d'une graduation. */
const net = (v: number) => Number(v.toPrecision(12));

/** Pas « rond » (1, 2, 2,5, 5 × 10^n) au moins égal à `brut`. */
export function pasArrondi(brut: number): number {
  if (!Number.isFinite(brut) || brut <= 0) return 1;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * puissance >= brut * (1 - 1e-12)) return net(m * puissance);
  }
  return net(10 * puissance);
}

/** Domaine affiché : graduations rondes qui encadrent toutes les valeurs (au moins deux). */
export function echelle(valeurs: readonly number[], intervalles = 4): number[] {
  let min = Math.min(...valeurs);
  let max = Math.max(...valeurs);
  if (min === max) {
    const marge = Math.abs(min) * 0.1 || 1;
    min -= marge;
    max += marge;
  }
  const pas = pasArrondi((max - min) / intervalles);
  const debut = Math.floor(net(min / pas)) * pas;
  const fin = Math.ceil(net(max / pas)) * pas;
  const n = Math.round((fin - debut) / pas);
  return Array.from({ length: n + 1 }, (_, i) => net(debut + i * pas));
}

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

function trait(points: readonly { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Suites de points consécutifs non nuls (au moins deux points pour un tracé). */
function segments(points: readonly ({ x: number; y: number } | null)[]): string[] {
  const traits: string[] = [];
  let courant: { x: number; y: number }[] = [];
  for (const p of [...points, null]) {
    if (p) {
      courant.push(p);
      continue;
    }
    if (courant.length >= 2) traits.push(trait(courant));
    courant = [];
  }
  return traits;
}

/**
 * Abscisses libellées : une sur `pas` (au plus `max` libellés), la première et la dernière
 * toujours ; le libellé régulier trop proche du dernier est omis (chevauchement).
 */
export function estLibellee(i: number, n: number, max: number): boolean {
  if (n <= 1) return i === 0;
  if (i === 0 || i === n - 1) return true;
  const pas = Math.max(1, Math.ceil((n - 1) / Math.max(1, max - 1)));
  if (i % pas !== 0) return false;
  const dernierRegulier = n - 1 - ((n - 1) % pas);
  return (n - 1) % pas === 0 || i !== dernierRegulier;
}

export function geometrieSerie(
  entrees: readonly PointSerieEntree[],
  options: OptionsGeometrie = {},
): GeometrieSerie {
  const largeur = options.largeur ?? 400;
  const hauteur = options.hauteur ?? 220;
  const maxLibelles = Math.max(2, options.maxLibelles ?? 5);
  const libellePeriode = options.libellePeriode ?? ((c: string) => c);
  const libelleValeur = options.libelleValeur ?? ((v: number) => compact.format(v));
  const zone = { gauche: 52, droite: largeur - 12, haut: 12, bas: hauteur - 32 };
  const n = entrees.length;
  const x = (i: number) =>
    arrondi(
      n <= 1
        ? (zone.gauche + zone.droite) / 2
        : zone.gauche + (i * (zone.droite - zone.gauche)) / (n - 1),
    );
  const abscisses = entrees.map((e, i) => ({
    periode: e.periode,
    x: x(i),
    libelle: estLibellee(i, n, maxLibelles) ? libellePeriode(e.periode) : null,
  }));
  const nombres = entrees.flatMap((e) =>
    [e.valeur, e.cible].filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  if (nombres.length === 0) {
    return {
      largeur,
      hauteur,
      zone,
      graduations: [],
      abscisses,
      traitsValeur: [],
      traitsCible: [],
      points: [],
      vide: true,
    };
  }
  const graduations = echelle(nombres);
  const bas = graduations[0] as number;
  const haut = graduations[graduations.length - 1] as number;
  const y = (v: number) =>
    arrondi(zone.haut + ((haut - v) / (haut - bas)) * (zone.bas - zone.haut));
  const placer = (v: number | null, i: number) =>
    v === null || !Number.isFinite(v) ? null : { x: x(i), y: y(v) };
  return {
    largeur,
    hauteur,
    zone,
    graduations: graduations.map((g) => ({ valeur: g, y: y(g), libelle: libelleValeur(g) })),
    abscisses,
    traitsValeur: segments(entrees.map((e, i) => placer(e.valeur, i))),
    traitsCible: segments(entrees.map((e, i) => placer(e.cible, i))),
    points: entrees.flatMap((e, i) =>
      e.valeur === null || !Number.isFinite(e.valeur)
        ? []
        : [
            {
              periode: e.periode,
              x: x(i),
              y: y(e.valeur),
              valeur: e.valeur,
              statut: e.statut,
              close: e.close,
            },
          ],
    ),
    vide: false,
  };
}

/** Forme du repère d'un point selon son statut (la forme double la couleur). */
export type FormeRepere = "rond" | "carre" | "triangle" | "anneau";

export function formeRepere(statut: StatutKpi): FormeRepere {
  switch (statut) {
    case "vert":
      return "rond";
    case "orange":
      return "carre";
    case "rouge":
      return "triangle";
    default:
      return "anneau";
  }
}

/** Triangle pointe en haut centré sur (x, y), pour le statut rouge. */
export function pointsTriangle(x: number, y: number, rayon = 6): string {
  const h = rayon * 1.15;
  return trait([
    { x: arrondi(x), y: arrondi(y - h) },
    { x: arrondi(x + rayon), y: arrondi(y + h * 0.6) },
    { x: arrondi(x - rayon), y: arrondi(y + h * 0.6) },
  ]);
}
