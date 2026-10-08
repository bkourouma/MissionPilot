/**
 * Évaluation d'une condition de modulation, avec journal de chaque feuille
 * vérifiée (facteur, comparateur, valeur attendue, valeur LUE, résultat).
 *
 * Sémantique :
 * - toutes les feuilles sont évaluées, sans court-circuit, pour que le
 *   journal soit complet ; l'ordre du journal est l'ordre de la condition ;
 * - un facteur NON RENSEIGNÉ (absent ou `null`) rend toute comparaison
 *   fausse, « différent » compris : une règle ne se déclenche jamais sur une
 *   donnée inconnue (`non` permet de l'exprimer explicitement) ;
 * - égal / différent : scalaires seulement (un facteur liste ne s'y compare
 *   pas) ; inférieur, supérieur… : nombres ; « dans » : la valeur lue (ou l'un
 *   des éléments d'un facteur liste) figure dans l'ensemble attendu ;
 *   « contient » : le facteur liste contient l'élément attendu (ou tous les
 *   éléments attendus) ;
 * - `brique_active` lit l'état d'une brique après les règles qui la
 *   modifient (ordre de dépendance garanti par l'application).
 */
import type {
  ComparateurModulation,
  ConditionModulation,
  ContexteModulation,
  ValeurComparee,
  ValeurFacteurContexte,
} from "./types";

export interface VerificationCondition {
  /** Chemin de la feuille dans la règle (`condition.conditions[1]`). */
  readonly chemin: string;
  readonly type: "comparaison" | "brique_active";
  readonly facteur: string | null;
  readonly comparateur: ComparateurModulation | null;
  readonly attendu: ValeurComparee | null;
  readonly brique: string | null;
  /** Valeur lue (facteur ou état de la brique) ; null si le facteur n'est pas renseigné. */
  readonly lu: ValeurFacteurContexte | null;
  readonly resultat: boolean;
}

/** Valeur propre du contexte (jamais une propriété héritée du prototype). */
export function lireFacteur(
  contexte: ContexteModulation,
  facteur: string,
): ValeurFacteurContexte | null {
  if (!Object.hasOwn(contexte, facteur)) return null;
  return contexte[facteur] ?? null;
}

export function comparerValeur(
  lu: ValeurFacteurContexte | null,
  comparateur: ComparateurModulation,
  attendu: ValeurComparee,
): boolean {
  if (lu === null) return false;
  const liste = Array.isArray(lu);
  switch (comparateur) {
    case "egal":
      return !liste && !Array.isArray(attendu) && lu === attendu;
    case "different":
      return !liste && !Array.isArray(attendu) && lu !== attendu;
    case "inferieur":
    case "inferieur_ou_egal":
    case "superieur":
    case "superieur_ou_egal":
      return (
        typeof lu === "number" && typeof attendu === "number" && ordonner(lu, comparateur, attendu)
      );
    case "dans": {
      if (!Array.isArray(attendu)) return false;
      const ensemble = attendu as readonly unknown[];
      return liste
        ? (lu as readonly string[]).some((v) => ensemble.includes(v))
        : ensemble.includes(lu);
    }
    case "contient": {
      if (!liste) return false;
      const elements = lu as readonly string[];
      return Array.isArray(attendu)
        ? (attendu as readonly unknown[]).every((v) => elements.includes(v as string))
        : elements.includes(attendu as string);
    }
  }
}

function ordonner(lu: number, comparateur: ComparateurModulation, attendu: number): boolean {
  if (comparateur === "inferieur") return lu < attendu;
  if (comparateur === "inferieur_ou_egal") return lu <= attendu;
  if (comparateur === "superieur") return lu > attendu;
  return lu >= attendu;
}

/** Évalue la condition et ajoute au journal chaque feuille vérifiée. */
export function evaluerCondition(
  condition: ConditionModulation,
  contexte: ContexteModulation,
  briqueActive: (brique: string) => boolean,
  chemin: string,
  journal: VerificationCondition[],
): boolean {
  switch (condition.type) {
    case "tous":
    case "au_moins_un": {
      const resultats = condition.conditions.map((c, i) =>
        evaluerCondition(c, contexte, briqueActive, `${chemin}.conditions[${i}]`, journal),
      );
      return condition.type === "tous" ? resultats.every(Boolean) : resultats.some(Boolean);
    }
    case "non":
      return !evaluerCondition(
        condition.condition,
        contexte,
        briqueActive,
        `${chemin}.condition`,
        journal,
      );
    case "comparaison": {
      const lu = lireFacteur(contexte, condition.facteur);
      const resultat = comparerValeur(lu, condition.comparateur, condition.valeur);
      journal.push({
        chemin,
        type: "comparaison",
        facteur: condition.facteur,
        comparateur: condition.comparateur,
        attendu: condition.valeur,
        brique: null,
        lu,
        resultat,
      });
      return resultat;
    }
    case "brique_active": {
      const resultat = briqueActive(condition.brique);
      journal.push({
        chemin,
        type: "brique_active",
        facteur: null,
        comparateur: null,
        attendu: null,
        brique: condition.brique,
        lu: resultat,
        resultat,
      });
      return resultat;
    }
  }
}
