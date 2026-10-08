/**
 * Données du rapport de notation (NOT-07) et comparaison avant/après
 * (NOT-08, partie calcul), en structures pures : aucun rendu ici.
 *
 * Toutes ces fonctions lisent une « vue » de scores, que fournissent aussi
 * bien un résultat calculé (`ResultatNotation`) qu'un score ajusté
 * (`ScoreAjuste`) : le rapport publié montre les scores ajustés.
 */
import { classe as classeDe, rangClasse, type Classe } from "./classes";
import { ErreurNotation } from "./erreurs";
import { arrondir, depuisNombre, soustraire } from "./fraction";

export interface VueDimension {
  readonly dimension: string;
  readonly libelle: string;
  readonly famille?: string;
  readonly score: number | null;
}

export interface VueScores {
  readonly score: number | null;
  readonly classe: Classe | null;
  readonly dimensions: readonly VueDimension[];
}

export type Evolution = "hausse" | "baisse" | "stable" | "non_comparable";

export interface EcartScore {
  readonly avant: number | null;
  readonly apres: number | null;
  /** apres − avant, à 1 décimale ; null si l'un des deux manque. */
  readonly ecart: number | null;
  readonly evolution: Evolution;
}

export interface ComparaisonNotations {
  readonly global: EcartScore;
  readonly classeAvant: Classe | null;
  readonly classeApres: Classe | null;
  /** Nombre de classes gagnées (positif) ou perdues (négatif) ; null si non comparable. */
  readonly ecartClasses: number | null;
  readonly dimensions: readonly (EcartScore & {
    readonly dimension: string;
    readonly libelle: string;
  })[];
}

function ecart(avant: number | null, apres: number | null): EcartScore {
  if (avant === null || apres === null)
    return { avant, apres, ecart: null, evolution: "non_comparable" };
  const e = arrondir(soustraire(depuisNombre(apres), depuisNombre(avant)));
  return { avant, apres, ecart: e, evolution: e > 0 ? "hausse" : e < 0 ? "baisse" : "stable" };
}

/**
 * Compare deux notations (entrée et sortie de mission). Les dimensions sont
 * appariées par identifiant : ordre de la notation « après », puis celles qui
 * n'existent qu'« avant ». Les écarts se calculent sur les scores affichés.
 */
export function comparerNotations(avant: VueScores, apres: VueScores): ComparaisonNotations {
  const ids = [
    ...apres.dimensions.map((d) => d.dimension),
    ...avant.dimensions
      .map((d) => d.dimension)
      .filter((id) => !apres.dimensions.some((d) => d.dimension === id)),
  ];
  return {
    global: ecart(avant.score, apres.score),
    classeAvant: avant.classe,
    classeApres: apres.classe,
    ecartClasses:
      avant.classe === null || apres.classe === null
        ? null
        : rangClasse(apres.classe) - rangClasse(avant.classe),
    dimensions: ids.map((id) => {
      const a = avant.dimensions.find((d) => d.dimension === id);
      const p = apres.dimensions.find((d) => d.dimension === id);
      return {
        dimension: id,
        libelle: (p ?? (a as VueDimension)).libelle,
        ...ecart(a?.score ?? null, p?.score ?? null),
      };
    }),
  };
}

export interface SeuilsForcesFaiblesses {
  /** Score à partir duquel une dimension est un point fort (défaut 65, classe B). */
  readonly seuilForce?: number;
  /** Score sous lequel une dimension est un point faible (défaut 50, classes D et E). */
  readonly seuilFaiblesse?: number;
}

export const SEUIL_FORCE_DEFAUT = 65;
export const SEUIL_FAIBLESSE_DEFAUT = 50;

export interface DimensionClassee {
  readonly dimension: string;
  readonly libelle: string;
  readonly score: number;
}

/**
 * Points forts (score ≥ seuil de force, du meilleur au moins bon) et points
 * faibles (score < seuil de faiblesse, du plus faible au moins faible) ; à
 * score égal, l'ordre de la grille départage. Les dimensions non notables
 * n'apparaissent dans aucune liste.
 */
export function forcesEtFaiblesses(
  vue: VueScores,
  seuils: SeuilsForcesFaiblesses = {},
): { forces: DimensionClassee[]; faiblesses: DimensionClassee[] } {
  const force = seuils.seuilForce ?? SEUIL_FORCE_DEFAUT;
  const faiblesse = seuils.seuilFaiblesse ?? SEUIL_FAIBLESSE_DEFAUT;
  const valide = (s: number) => Number.isFinite(s) && s >= 0 && s <= 100;
  if (!valide(force) || !valide(faiblesse) || faiblesse > force) {
    throw new ErreurNotation(
      "OPTIONS_INVALIDES",
      "Seuils attendus entre 0 et 100, le seuil de faiblesse ne dépassant pas celui de force.",
    );
  }
  const notees = vue.dimensions.flatMap((d, rang) =>
    d.score === null
      ? []
      : [{ rang, d: { dimension: d.dimension, libelle: d.libelle, score: d.score } }],
  );
  return {
    forces: notees
      .filter((n) => n.d.score >= force)
      .sort((a, b) => b.d.score - a.d.score || a.rang - b.rang)
      .map((n) => n.d),
    faiblesses: notees
      .filter((n) => n.d.score < faiblesse)
      .sort((a, b) => a.d.score - b.d.score || a.rang - b.rang)
      .map((n) => n.d),
  };
}

export interface BarreDimension {
  readonly dimension: string;
  readonly libelle: string;
  readonly score: number | null;
  readonly classe: Classe | null;
}

export interface DonneesRapport {
  readonly global: { readonly score: number | null; readonly classe: Classe | null };
  /** Axes du radar de maturité, dans l'ordre de la grille (score null = non notable). */
  readonly radar: readonly {
    readonly dimension: string;
    readonly axe: string;
    readonly score: number | null;
  }[];
  /** Barres par pilier, regroupées par famille dans l'ordre de première apparition. */
  readonly barres: readonly {
    readonly famille: string;
    readonly dimensions: readonly BarreDimension[];
  }[];
  readonly forces: readonly DimensionClassee[];
  readonly faiblesses: readonly DimensionClassee[];
}

/** Données du rapport de notation : radar, barres par famille, forces et faiblesses. */
export function donneesRapport(
  vue: VueScores,
  seuils: SeuilsForcesFaiblesses = {},
): DonneesRapport {
  const { forces, faiblesses } = forcesEtFaiblesses(vue, seuils);
  const familles: { famille: string; dimensions: BarreDimension[] }[] = [];
  for (const d of vue.dimensions) {
    const code = d.famille ?? "";
    let groupe = familles.find((f) => f.famille === code);
    if (groupe === undefined) {
      groupe = { famille: code, dimensions: [] };
      familles.push(groupe);
    }
    groupe.dimensions.push({
      dimension: d.dimension,
      libelle: d.libelle,
      score: d.score,
      classe: d.score === null ? null : classeDe(d.score),
    });
  }
  return {
    global: { score: vue.score, classe: vue.classe },
    radar: vue.dimensions.map((d) => ({ dimension: d.dimension, axe: d.libelle, score: d.score })),
    barres: familles,
    forces,
    faiblesses,
  };
}
