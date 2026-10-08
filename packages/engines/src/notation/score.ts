/**
 * Scoring déterministe (NOT-03) : score par dimension et score global sur
 * 100, calculés depuis la grille.
 *
 * Dimension : moyenne des points des indicateurs pondérée par leur poids.
 * - Un indicateur « sans objet » (question invisible pour ce répondant, voir
 *   `preparerReponses`) sort du calcul : ni au numérateur ni au dénominateur.
 * - Un indicateur « manquant » (question applicable sans réponse) suit la
 *   stratégie choisie : `ignorer` (défaut) l'écarte et renormalise sur les
 *   indicateurs répondus ; `penaliser` lui donne 0 point.
 * - Couverture = poids des indicateurs répondus / poids des applicables. Sous
 *   `couvertureMinimale` (défaut 0,5), ou sans aucune réponse, la dimension
 *   est « non notable » : pas de score.
 *
 * Global : moyenne des dimensions notables pondérée par les poids normalisés
 * à 100 (secteur appliqué). Avec `ignorer`, les dimensions non notables sont
 * écartées et l'on renormalise ; avec `penaliser`, elles comptent pour 0.
 * Si le poids des dimensions notables est sous `couvertureGlobaleMinimale`
 * (défaut 0,5 du poids total), le score global n'est pas notable.
 *
 * Tous les calculs sont exacts (fractions) ; seul l'affichage est arrondi à
 * 1 décimale. Le score global se calcule sur les scores EXACTS des
 * dimensions : il peut différer de 0,1 d'une moyenne refaite à la main sur
 * les scores affichés. `scoreExact` (« num/den ») trace la valeur exacte.
 */
import { lireReponse, type Reponses } from "../questionnaires/types";
import { classe as classeDe, type Classe } from "./classes";
import { pointsExacts } from "./conversion";
import { ErreurNotation } from "./erreurs";
import {
  CENT,
  ZERO,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  multiplier,
  somme,
  versTexte,
  type Fraction,
} from "./fraction";
import {
  exigerGrilleValide,
  poidsExacts,
  poidsNormalises,
  type DimensionGrille,
  type GrilleNotation,
} from "./grille";

export type StrategieManquantes = "ignorer" | "penaliser";

export interface OptionsNotation {
  /** Code de secteur dont la surcharge de poids s'applique (défaut : poids de la grille). */
  readonly secteur?: string;
  readonly strategie?: StrategieManquantes;
  /** Part minimale (0-1) du poids des indicateurs applicables qui doit être répondue. */
  readonly couvertureMinimale?: number;
  /** Part minimale (0-1) du poids des dimensions qui doit être notable pour noter le global. */
  readonly couvertureGlobaleMinimale?: number;
  /** Questions sans objet pour ce répondant (invisibles) : leurs indicateurs sortent du calcul. */
  readonly nonApplicables?: readonly string[];
}

export const STRATEGIE_DEFAUT: StrategieManquantes = "ignorer";
export const COUVERTURE_MINIMALE_DEFAUT = 0.5;
export const COUVERTURE_GLOBALE_MINIMALE_DEFAUT = 0.5;

export type StatutIndicateur = "repondu" | "manquant" | "sans_objet";

export interface DetailIndicateur {
  readonly indicateur: string;
  readonly question: string;
  readonly statut: StatutIndicateur;
  /** Points sur 100 arrondis à 1 décimale (null si manquant ou sans objet). */
  readonly points: number | null;
}

export interface ResultatDimension {
  readonly dimension: string;
  readonly libelle: string;
  readonly famille: string;
  readonly notable: boolean;
  readonly score: number | null;
  readonly scoreExact: string | null;
  readonly classe: Classe | null;
  /** Couverture (0-1) arrondie à 4 décimales. */
  readonly couverture: number;
  readonly indicateurs: readonly DetailIndicateur[];
}

export interface DimensionNotee extends ResultatDimension {
  /** Poids normalisé (somme 100) affiché au centième. */
  readonly poids: number;
  /** Poids normalisé exact (« num/den »). */
  readonly poidsExact: string;
}

export interface ResultatNotation {
  readonly grille: string;
  readonly version: number;
  readonly secteur: string | null;
  readonly strategie: StrategieManquantes;
  readonly notable: boolean;
  readonly score: number | null;
  readonly scoreExact: string | null;
  readonly classe: Classe | null;
  /** Part (0-1, 4 décimales) du poids des dimensions qui est notable. */
  readonly couverture: number;
  readonly dimensions: readonly DimensionNotee[];
}

/** Points d'un indicateur : fraction exacte, `null` (manquant) ou sans objet. */
export type PointsIndicateur = Fraction | null | "sans_objet";

interface OptionsResolues {
  readonly secteur: string | undefined;
  readonly strategie: StrategieManquantes;
  readonly couvertureMinimale: Fraction;
  readonly couvertureGlobaleMinimale: Fraction;
  readonly nonApplicables: ReadonlySet<string>;
}

function partValide(v: number, nom: string): Fraction {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new ErreurNotation(
      "OPTIONS_INVALIDES",
      `${nom} doit être comprise entre 0 et 1 (reçu ${v}).`,
    );
  }
  return depuisNombre(v);
}

export function resoudreOptions(options: OptionsNotation = {}): OptionsResolues {
  const strategie = options.strategie ?? STRATEGIE_DEFAUT;
  if (strategie !== "ignorer" && strategie !== "penaliser") {
    throw new ErreurNotation("OPTIONS_INVALIDES", `Stratégie inconnue : « ${String(strategie)} ».`);
  }
  return {
    secteur: options.secteur,
    strategie,
    couvertureMinimale: partValide(
      options.couvertureMinimale ?? COUVERTURE_MINIMALE_DEFAUT,
      "La couverture minimale",
    ),
    couvertureGlobaleMinimale: partValide(
      options.couvertureGlobaleMinimale ?? COUVERTURE_GLOBALE_MINIMALE_DEFAUT,
      "La couverture globale minimale",
    ),
    nonApplicables: new Set(options.nonApplicables ?? []),
  };
}

function ratio4(f: Fraction): number {
  return arrondir(f, 4);
}

interface DimensionCalculee {
  readonly resultat: ResultatDimension;
  readonly exact: Fraction | null;
}

function calculerDimension(
  d: DimensionGrille,
  points: (indicateur: string) => PointsIndicateur,
  opts: OptionsResolues,
): DimensionCalculee {
  const lignes = d.indicateurs.map((ind) => ({
    ind,
    poids: depuisNombre(ind.poids),
    p: points(ind.id),
  }));
  const applicables = lignes.filter((l) => l.p !== "sans_objet");
  const repondus = applicables.filter((l): l is typeof l & { p: Fraction } => l.p !== null);
  const poidsApplicable = somme(applicables.map((l) => l.poids));
  const poidsRepondu = somme(repondus.map((l) => l.poids));
  const couverture = estNul(poidsApplicable) ? ZERO : diviser(poidsRepondu, poidsApplicable);
  const notable = repondus.length > 0 && comparer(couverture, opts.couvertureMinimale) >= 0;
  const denominateur = opts.strategie === "penaliser" ? poidsApplicable : poidsRepondu;
  const exact = notable
    ? diviser(somme(repondus.map((l) => multiplier(l.poids, l.p))), denominateur)
    : null;
  const score = exact === null ? null : arrondir(exact);
  return {
    exact,
    resultat: {
      dimension: d.id,
      libelle: d.libelle,
      famille: d.famille,
      notable,
      score,
      scoreExact: exact === null ? null : versTexte(exact),
      classe: score === null ? null : classeDe(score),
      couverture: ratio4(couverture),
      indicateurs: lignes.map((l) => ({
        indicateur: l.ind.id,
        question: l.ind.question,
        statut: l.p === "sans_objet" ? "sans_objet" : l.p === null ? "manquant" : "repondu",
        points: l.p === "sans_objet" || l.p === null ? null : arrondir(l.p),
      })),
    },
  };
}

/** Points de chaque indicateur d'une grille pour un jeu de réponses. */
export function pointsParIndicateur(
  grille: GrilleNotation,
  reponses: Reponses,
  nonApplicables: ReadonlySet<string> = new Set(),
): Map<string, PointsIndicateur> {
  const points = new Map<string, PointsIndicateur>();
  for (const d of grille.dimensions) {
    for (const ind of d.indicateurs) {
      points.set(
        ind.id,
        nonApplicables.has(ind.question)
          ? "sans_objet"
          : pointsExacts(ind.conversion, lireReponse(reponses, ind.question)),
      );
    }
  }
  return points;
}

/** Score d'une dimension isolée (0-100), selon la stratégie et la couverture minimale. */
export function scoreDimension(
  dimension: DimensionGrille,
  reponses: Reponses,
  options: OptionsNotation = {},
): ResultatDimension {
  const grille: GrilleNotation = {
    id: "dimension",
    version: 1,
    titre: dimension.libelle,
    dimensions: [{ ...dimension, poids: 1 }],
  };
  exigerGrilleValide(grille);
  const opts = resoudreOptions(options);
  const points = pointsParIndicateur(grille, reponses, opts.nonApplicables);
  return calculerDimension(dimension, (id) => points.get(id) as PointsIndicateur, opts).resultat;
}

/** Agrège des points d'indicateurs déjà calculés (un répondant ou une moyenne de répondants). */
export function noterDepuisPoints(
  grille: GrilleNotation,
  points: ReadonlyMap<string, PointsIndicateur>,
  options: OptionsNotation = {},
): ResultatNotation {
  exigerGrilleValide(grille);
  const opts = resoudreOptions(options);
  const exacts = poidsExacts(grille, opts.secteur);
  const affiches = poidsNormalises(grille, opts.secteur);
  const lire = (id: string): PointsIndicateur => points.get(id) ?? null;

  const dimensions = grille.dimensions.map((d, i) => {
    const calcul = calculerDimension(d, lire, opts);
    const poids = (exacts.poids[i] as { poids: Fraction }).poids;
    return { calcul, poids, affiche: (affiches.poids[i] as { poids: number }).poids };
  });
  const notables = dimensions.filter((d) => d.calcul.exact !== null && !estNul(d.poids));
  const poidsNotable = somme(notables.map((d) => d.poids));
  const couverture = diviser(poidsNotable, CENT);
  const notable =
    !estNul(poidsNotable) && comparer(couverture, opts.couvertureGlobaleMinimale) >= 0;
  const denominateur = opts.strategie === "penaliser" ? CENT : poidsNotable;
  const exact = notable
    ? diviser(
        somme(notables.map((d) => multiplier(d.poids, d.calcul.exact as Fraction))),
        denominateur,
      )
    : null;
  const score = exact === null ? null : arrondir(exact);

  return {
    grille: grille.id,
    version: grille.version,
    secteur: exacts.secteurApplique,
    strategie: opts.strategie,
    notable,
    score,
    scoreExact: exact === null ? null : versTexte(exact),
    classe: score === null ? null : classeDe(score),
    couverture: ratio4(couverture),
    dimensions: dimensions.map((d) => ({
      ...d.calcul.resultat,
      poids: d.affiche,
      poidsExact: versTexte(d.poids),
    })),
  };
}

/** Score global (0-100) et scores par dimension d'un jeu de réponses. */
export function scoreGlobal(
  grille: GrilleNotation,
  reponses: Reponses,
  options: OptionsNotation = {},
): ResultatNotation {
  exigerGrilleValide(grille);
  const opts = resoudreOptions(options);
  return noterDepuisPoints(
    grille,
    pointsParIndicateur(grille, reponses, opts.nonApplicables),
    options,
  );
}
