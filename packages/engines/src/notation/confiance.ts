/**
 * Indice de confiance d'une note (NOT-11, PRD complémentaire §11.1), affiché avec la note ;
 * la publication est refusée sous un seuil paramétrable par le cabinet (contrôle de l'API et
 * déclencheur MPN10, migration 0402).
 *
 * Formule (valeurs à calibrer au pilote) :
 * - couverture C : part du poids des items applicables qui a reçu une réponse, pondérée par
 *   le poids normalisé des dimensions (Σ poids_d × couverture_d / Σ poids_d) ;
 * - répondants R : min(n, cible) / cible, n = jeux de réponses soumis utilisés par le calcul,
 *   cible paramétrable (3 par défaut) ;
 * - preuves P : solidité des preuves (moteur `preuves`, PRV-02) des assertions rattachées à
 *   chaque dimension ; moyenne par dimension (0 sans assertion), pondérée comme C ;
 * - indice = (40 C + 30 R + 30 P) / 100, poids en centièmes paramétrables (somme 100).
 * Lecture : « élevée » ≥ 0,75 ; « suffisante » ≥ seuil ; « insuffisante » sous le seuil.
 * Publiable si l'indice EXACT ≥ seuil (fractions exactes, arrondi à 4 décimales en sortie).
 * `publiable` FAIT FOI : l'indice affiché (`indice`) est arrondi à 4 décimales et peut donc
 * égaler le seuil sans que l'indice exact l'atteigne (exact 0,49996 affiché 0,5000 : NON
 * publiable) ; l'inverse est impossible (le seuil a au plus 4 décimales, l'arrondi est monotone),
 * si bien que la contrainte de base `NOT publiable OR indice >= seuil` reste vraie. Tout appelant
 * décide d'après `publiable`, jamais en comparant `indice` et `seuil`.
 */
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import {
  ZERO,
  ajouter,
  arrondir,
  comparer,
  depuisNombre,
  depuisTexte,
  diviser,
  estNul,
  fraction,
  multiplier,
  somme,
  type Fraction,
} from "./fraction";
import type { ResultatNotation } from "./score";

export const SEUIL_CONFIANCE_DEFAUT = 0.5;
export const REPONDANTS_CIBLE_DEFAUT = 3;
export const SEUIL_CONFIANCE_ELEVEE = 0.75;
export const POIDS_CONFIANCE_DEFAUT = { couverture: 40, repondants: 30, preuves: 30 } as const;

export type NiveauConfiance = "elevee" | "suffisante" | "insuffisante";

export interface SoliditeDimension {
  readonly dimension: string;
  /** Indice de solidité (0-1) d'une assertion rattachée à la dimension (moteur `preuves`). */
  readonly indice: number;
}

export interface EntreeConfiance {
  readonly resultat: ResultatNotation;
  readonly repondants: number;
  readonly solidites: readonly SoliditeDimension[];
}

export interface OptionsConfiance {
  readonly seuil?: number;
  readonly repondantsCible?: number;
  readonly poids?: {
    readonly couverture: number;
    readonly repondants: number;
    readonly preuves: number;
  };
}

export interface IndiceConfiance {
  readonly indice: number;
  readonly seuil: number;
  readonly publiable: boolean;
  readonly niveau: NiveauConfiance;
  readonly couverture: { readonly valeur: number; readonly poids: number };
  readonly repondants: {
    readonly valeur: number;
    readonly poids: number;
    readonly nombre: number;
    readonly cible: number;
  };
  readonly preuves: {
    readonly valeur: number;
    readonly poids: number;
    readonly dimensionsEtayees: number;
    readonly dimensions: number;
    readonly assertions: number;
  };
}

const dansIntervalle = (v: number, min: number, max: number) =>
  Number.isFinite(v) && v >= min && v <= max;

function verifier(entree: EntreeConfiance, options: OptionsConfiance) {
  const seuil = options.seuil ?? SEUIL_CONFIANCE_DEFAUT;
  const cible = options.repondantsCible ?? REPONDANTS_CIBLE_DEFAUT;
  const poids = options.poids ?? POIDS_CONFIANCE_DEFAUT;
  const refus = (m: string) => new ErreurNotationAugmentee("OPTIONS_INVALIDES", m);
  if (!dansIntervalle(seuil, 0, 1)) throw refus("Le seuil de confiance est compris entre 0 et 1.");
  if (!Number.isInteger(cible) || cible < 1 || cible > 1000)
    throw refus("Cible de répondants invalide.");
  const valeurs = [poids.couverture, poids.repondants, poids.preuves];
  if (
    !valeurs.every((p) => Number.isInteger(p) && p >= 0) ||
    valeurs.reduce((s, p) => s + p, 0) !== 100
  ) {
    throw refus("Les poids de l'indice sont des entiers positifs de somme 100.");
  }
  if (!Number.isInteger(entree.repondants) || entree.repondants < 0) {
    throw refus("Nombre de répondants invalide.");
  }
  if (!entree.solidites.every((s) => dansIntervalle(s.indice, 0, 1))) {
    throw refus("Un indice de solidité est compris entre 0 et 1.");
  }
  return { seuil, cible, poids };
}

/** Moyenne pondérée par les poids exacts des dimensions (0 si aucun poids). */
function moyennePonderee(
  resultat: ResultatNotation,
  valeur: (dimension: string, couverture: number) => Fraction,
): Fraction {
  const lignes = resultat.dimensions.map((d) => ({
    poids: depuisTexte(d.poidsExact),
    valeur: valeur(d.dimension, d.couverture),
  }));
  const total = somme(lignes.map((l) => l.poids));
  if (estNul(total)) return ZERO;
  return diviser(somme(lignes.map((l) => multiplier(l.poids, l.valeur))), total);
}

/** Indice de confiance d'un résultat de notation (formule en tête du fichier). */
export function indiceConfiance(
  entree: EntreeConfiance,
  options: OptionsConfiance = {},
): IndiceConfiance {
  const { seuil, cible, poids } = verifier(entree, options);
  const couverture = moyennePonderee(entree.resultat, (_d, c) => depuisNombre(c));
  const repondants = fraction(BigInt(Math.min(entree.repondants, cible)), BigInt(cible));
  const parDimension = new Map<string, Fraction[]>();
  for (const s of entree.solidites) {
    parDimension.set(s.dimension, [
      ...(parDimension.get(s.dimension) ?? []),
      depuisNombre(s.indice),
    ]);
  }
  const preuves = moyennePonderee(entree.resultat, (d) => {
    const indices = parDimension.get(d) ?? [];
    return indices.length === 0 ? ZERO : diviser(somme(indices), fraction(BigInt(indices.length)));
  });
  const exact = diviser(
    ajouter(
      ajouter(
        multiplier(couverture, fraction(BigInt(poids.couverture))),
        multiplier(repondants, fraction(BigInt(poids.repondants))),
      ),
      multiplier(preuves, fraction(BigInt(poids.preuves))),
    ),
    fraction(100n),
  );
  const publiable = comparer(exact, depuisNombre(seuil)) >= 0;
  const eleve = comparer(exact, depuisNombre(SEUIL_CONFIANCE_ELEVEE)) >= 0;
  const dimensions = new Set(entree.resultat.dimensions.map((d) => d.dimension));
  return {
    indice: arrondir(exact, 4),
    seuil,
    publiable,
    niveau: publiable && eleve ? "elevee" : publiable ? "suffisante" : "insuffisante",
    couverture: { valeur: arrondir(couverture, 4), poids: poids.couverture },
    repondants: {
      valeur: arrondir(repondants, 4),
      poids: poids.repondants,
      nombre: entree.repondants,
      cible,
    },
    preuves: {
      valeur: arrondir(preuves, 4),
      poids: poids.preuves,
      dimensionsEtayees: [...parDimension.keys()].filter((d) => dimensions.has(d)).length,
      dimensions: dimensions.size,
      assertions: entree.solidites.filter((s) => dimensions.has(s.dimension)).length,
    },
  };
}
