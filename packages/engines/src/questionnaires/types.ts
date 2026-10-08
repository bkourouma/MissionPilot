/**
 * Définition d'un questionnaire en données pures (SOC-10).
 *
 * Un questionnaire est une liste ordonnée de sections, chacune composée de
 * questions typées. Les identifiants (questionnaire, sections, questions,
 * options) sont des codes stables : ils servent de clés aux réponses, aux
 * conditions et aux grilles de notation, et ne doivent jamais être recyclés.
 *
 * Une question ou une section peut porter une condition d'affichage qui lit
 * les réponses à d'autres questions (voir `conditions.ts`).
 */
import type { DateISO } from "../commun/dates";

export type TypeQuestion =
  "likert" | "choix_unique" | "choix_multiple" | "texte" | "numerique" | "oui_non" | "date";

/** Valeur comparée dans une condition (code d'option, nombre, booléen, texte, date ISO). */
export type ValeurCondition = string | number | boolean;

/**
 * Condition d'affichage. Toute comparaison portant sur une réponse vide (ou
 * sur une question elle-même invisible) est fausse, sauf `vide` ; `non`
 * permet d'exprimer l'inverse. Sur un choix multiple, `egal` signifie « la
 * sélection contient la valeur » et `dans` « la sélection contient au moins
 * une des valeurs ».
 */
export type Condition =
  | { readonly op: "egal"; readonly question: string; readonly valeur: ValeurCondition }
  | { readonly op: "different"; readonly question: string; readonly valeur: ValeurCondition }
  | { readonly op: "dans"; readonly question: string; readonly valeurs: readonly ValeurCondition[] }
  | { readonly op: "superieur"; readonly question: string; readonly valeur: number | string }
  | { readonly op: "inferieur"; readonly question: string; readonly valeur: number | string }
  | { readonly op: "vide"; readonly question: string }
  | { readonly op: "et"; readonly conditions: readonly Condition[] }
  | { readonly op: "ou"; readonly conditions: readonly Condition[] }
  | { readonly op: "non"; readonly condition: Condition };

interface QuestionCommune {
  readonly id: string;
  readonly libelle: string;
  readonly aide?: string;
  readonly obligatoire: boolean;
  readonly condition?: Condition;
}

/** Échelle de Likert 1..points ; `libelles[i]` décrit le niveau i + 1. */
export interface QuestionLikert extends QuestionCommune {
  readonly type: "likert";
  readonly points: number;
  readonly libelles: readonly string[];
}

export interface OptionChoix {
  readonly code: string;
  readonly libelle: string;
}

export interface QuestionChoixUnique extends QuestionCommune {
  readonly type: "choix_unique";
  readonly options: readonly OptionChoix[];
}

export interface QuestionChoixMultiple extends QuestionCommune {
  readonly type: "choix_multiple";
  readonly options: readonly OptionChoix[];
  /** Nombre minimal de cases cochées lorsqu'une réponse est donnée (défaut 1). */
  readonly minSelections?: number;
  /** Nombre maximal de cases cochées (défaut : toutes). */
  readonly maxSelections?: number;
}

export interface QuestionTexte extends QuestionCommune {
  readonly type: "texte";
  /** Longueur maximale après suppression des espaces de bord (défaut 2 000). */
  readonly longueurMax?: number;
}

export interface QuestionNumerique extends QuestionCommune {
  readonly type: "numerique";
  readonly min?: number;
  readonly max?: number;
  readonly unite?: string;
  /** Exige un entier. */
  readonly entier?: boolean;
}

export interface QuestionOuiNon extends QuestionCommune {
  readonly type: "oui_non";
}

export interface QuestionDate extends QuestionCommune {
  readonly type: "date";
  readonly min?: DateISO;
  readonly max?: DateISO;
}

export type Question =
  | QuestionLikert
  | QuestionChoixUnique
  | QuestionChoixMultiple
  | QuestionTexte
  | QuestionNumerique
  | QuestionOuiNon
  | QuestionDate;

export interface Section {
  readonly id: string;
  readonly titre: string;
  readonly description?: string;
  /** Condition commune à toutes les questions de la section. */
  readonly condition?: Condition;
  readonly questions: readonly Question[];
}

export interface DefinitionQuestionnaire {
  readonly id: string;
  readonly version: number;
  readonly titre: string;
  readonly sections: readonly Section[];
}

/**
 * Valeur d'une réponse : nombre (likert, numérique), code d'option (choix
 * unique), liste de codes (choix multiple), texte, booléen (oui/non), date ISO.
 * `null` ou absence = pas de réponse.
 */
export type ValeurReponse = number | string | boolean | readonly string[];

/** Réponses d'un répondant, indexées par identifiant de question. */
export type Reponses = Readonly<Record<string, ValeurReponse | null | undefined>>;

/** Identifiant stable : minuscules, chiffres, `_`, `.`, `-`, 80 caractères au plus. */
export const FORMAT_IDENTIFIANT = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

/** Profondeur maximale d'imbrication d'une condition (une comparaison = 1). */
export const PROFONDEUR_MAX_CONDITION = 5;

/** Nombre de points admis pour une échelle de Likert. */
export const POINTS_LIKERT_MIN = 2;
export const POINTS_LIKERT_MAX = 10;

/** Longueur maximale par défaut d'une réponse texte. */
export const LONGUEUR_TEXTE_DEFAUT = 2_000;
export const LONGUEUR_TEXTE_PLAFOND = 20_000;

/** Lit une réponse propre à `reponses` (jamais une propriété héritée du prototype). */
export function lireReponse(reponses: Reponses, id: string): ValeurReponse | null {
  if (!Object.prototype.hasOwnProperty.call(reponses, id)) return null;
  return reponses[id] ?? null;
}

/** Vrai si la valeur est une absence de réponse (`null`, texte blanc, liste vide). */
export function estVide(valeur: ValeurReponse | null | undefined): boolean {
  if (valeur === null || valeur === undefined) return true;
  if (typeof valeur === "string") return valeur.trim() === "";
  if (Array.isArray(valeur)) return valeur.length === 0;
  return false;
}

/** Liste à plat des questions, dans l'ordre de la définition. */
export function toutesLesQuestions(def: DefinitionQuestionnaire): Question[] {
  return def.sections.flatMap((s) => s.questions);
}
