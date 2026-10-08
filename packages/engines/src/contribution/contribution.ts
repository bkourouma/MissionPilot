/**
 * Contribution de l'IA par livrable (AGT-05, PRD complémentaire §7.2) : part
 * du brouillon IA conservée après validation, distance d'édition, modification
 * majeure (critère de promotion d'autonomie, AGT-03) et temps de revue.
 *
 * Définitions :
 * - part conservée = mots du brouillon conservés dans l'ordre (plus longue
 *   sous-suite commune) / mots du brouillon, en pour-cent entier arrondi au
 *   plus proche (demi vers le haut) ; `null` pour un brouillon vide ;
 * - taux de modification = distance de Levenshtein en mots / nombre de mots du
 *   plus long des deux textes, en pour-cent entier arrondi ; 0 si les deux
 *   textes sont vides ;
 * - modification majeure : taux de modification STRICTEMENT supérieur au seuil
 *   (25 % par défaut, à calibrer au pilote), comparé en entiers sur la valeur
 *   exacte, jamais sur l'arrondi.
 */
import { arrondirRatio } from "../commun/ratio";
import { cellulesMaxValide, decouperMots, distanceMots, motsConserves } from "./distance";
import { ErreurContribution } from "./erreurs";

/** Seuil par défaut d'une modification majeure, en pour-cent du texte le plus long. */
export const SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT = 25;

/** Pour-cent entier de `numerateur / denominateur`, demi vers le haut (entrées entières ≥ 0). */
function pourCentEntier(numerateur: number, denominateur: number): number {
  return Math.floor((200 * numerateur + denominateur) / (2 * denominateur));
}

function seuilValide(seuil: unknown): number {
  if (typeof seuil !== "number" || !Number.isInteger(seuil) || seuil < 0 || seuil > 100) {
    throw new ErreurContribution("OPTIONS_INVALIDES", "Seuil de modification majeure : 0 à 100.");
  }
  return seuil;
}

export interface ModificationMajeure {
  readonly majeure: boolean;
  /** Taux de modification en pour-cent entier arrondi. */
  readonly tauxModificationPct: number;
  readonly seuilPct: number;
}

/** Dit si une édition est majeure au regard du seuil (pour-cent entier de 0 à 100). */
export function evaluerModificationMajeure(
  mesure: {
    readonly distance: number;
    readonly motsBrouillon: number;
    readonly motsValides: number;
  },
  seuilPct: number = SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT,
): ModificationMajeure {
  const seuil = seuilValide(seuilPct);
  const { distance, motsBrouillon, motsValides } = mesure;
  for (const v of [distance, motsBrouillon, motsValides]) {
    if (!Number.isInteger(v) || v < 0) {
      throw new ErreurContribution("OPTIONS_INVALIDES", "Mesure d'édition invalide.");
    }
  }
  const plusLong = Math.max(motsBrouillon, motsValides);
  if (distance > plusLong) {
    throw new ErreurContribution(
      "OPTIONS_INVALIDES",
      "Distance supérieure à la longueur des textes.",
    );
  }
  if (plusLong === 0) return { majeure: false, tauxModificationPct: 0, seuilPct: seuil };
  return {
    majeure: 100 * distance > seuil * plusLong,
    tauxModificationPct: pourCentEntier(distance, plusLong),
    seuilPct: seuil,
  };
}

export interface TempsRevue {
  readonly sessions: number;
  readonly totalSecondes: number;
  /** Médiane des sessions, en secondes entières (demi vers le haut) ; 0 sans session. */
  readonly medianeSecondes: number;
  readonly maxSecondes: number;
}

/** Agrège les durées de revue d'un livrable (secondes entières ≥ 0). */
export function agregerTempsRevue(durees: readonly number[]): TempsRevue {
  for (const d of durees) {
    if (!Number.isSafeInteger(d) || d < 0) {
      throw new ErreurContribution("DUREE_INVALIDE", "Durée de revue : secondes entières ≥ 0.");
    }
  }
  if (durees.length === 0)
    return { sessions: 0, totalSecondes: 0, medianeSecondes: 0, maxSecondes: 0 };
  const tries = [...durees].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  const mediane =
    tries.length % 2 === 1
      ? tries[milieu]!
      : Math.floor((tries[milieu - 1]! + tries[milieu]! + 1) / 2);
  return {
    sessions: tries.length,
    totalSecondes: tries.reduce((s, d) => s + d, 0),
    medianeSecondes: mediane,
    maxSecondes: tries[tries.length - 1]!,
  };
}

export interface OptionsContribution {
  readonly seuilModificationMajeurePct?: number;
  /** Budget de cellules par calcul de distance (voir `distance.ts`). */
  readonly cellulesMax?: number;
}

export interface ContributionIa {
  readonly motsBrouillon: number;
  readonly motsValides: number;
  /** Distance de Levenshtein en mots (majorant si `exacte` est faux). */
  readonly distance: number;
  /** Mots du brouillon conservés dans l'ordre (minorant si `exacte` est faux). */
  readonly motsConserves: number;
  /** Part du brouillon conservée, pour-cent entier ; null si le brouillon est vide. */
  readonly partConserveePct: number | null;
  readonly modification: ModificationMajeure;
  readonly tempsRevue: TempsRevue;
  /** Faux si le budget de calcul a imposé une estimation prudente. */
  readonly exacte: boolean;
}

/** Mesure la contribution de l'IA entre le brouillon IA et le texte validé d'un livrable. */
export function contributionIa(
  entree: {
    readonly brouillon: string;
    readonly valide: string;
    /** Durées des sessions de revue, en secondes. */
    readonly sessionsRevueSecondes?: readonly number[];
  },
  options: OptionsContribution = {},
): ContributionIa {
  const cellulesMax = cellulesMaxValide(options);
  const seuil = seuilValide(
    options.seuilModificationMajeurePct ?? SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT,
  );
  const brouillon = decouperMots(entree.brouillon);
  const valide = decouperMots(entree.valide);
  const tempsRevue = agregerTempsRevue(entree.sessionsRevueSecondes ?? []);
  const levenshtein = distanceMots(brouillon, valide, cellulesMax);
  const conserves = motsConserves(brouillon, valide, cellulesMax);
  return {
    motsBrouillon: brouillon.length,
    motsValides: valide.length,
    distance: levenshtein.distance,
    motsConserves: conserves.conserves,
    partConserveePct:
      brouillon.length === 0 ? null : pourCentEntier(conserves.conserves, brouillon.length),
    modification: evaluerModificationMajeure(
      {
        distance: levenshtein.distance,
        motsBrouillon: brouillon.length,
        motsValides: valide.length,
      },
      seuil,
    ),
    tempsRevue,
    exacte: levenshtein.exacte && conserves.exacte,
  };
}

export interface SyntheseContributionIa {
  readonly livrables: number;
  readonly motsBrouillon: number;
  readonly motsConserves: number;
  /** Part conservée pondérée par la taille des brouillons, 4 décimales ; null sans brouillon. */
  readonly partConservee: number | null;
  readonly modificationsMajeures: number;
  readonly totalRevueSecondes: number;
  readonly exacte: boolean;
}

/** Synthèse sur plusieurs livrables (mission, cabinet, brique). */
export function syntheseContributionsIa(
  contributions: readonly ContributionIa[],
): SyntheseContributionIa {
  let motsBrouillon = 0;
  let motsConservesTotal = 0;
  let majeures = 0;
  let revue = 0;
  let exacte = true;
  for (const c of contributions) {
    motsBrouillon += c.motsBrouillon;
    motsConservesTotal += c.motsConserves;
    if (c.modification.majeure) majeures += 1;
    revue += c.tempsRevue.totalSecondes;
    exacte &&= c.exacte;
  }
  return {
    livrables: contributions.length,
    motsBrouillon,
    motsConserves: motsConservesTotal,
    partConservee: motsBrouillon === 0 ? null : arrondirRatio(motsConservesTotal / motsBrouillon),
    modificationsMajeures: majeures,
    totalRevueSecondes: revue,
    exacte,
  };
}
