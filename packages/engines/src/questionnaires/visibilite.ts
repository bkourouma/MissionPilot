/**
 * Logique conditionnelle (SOC-10) : quelles questions sont visibles pour un
 * jeu de réponses donné.
 *
 * Règles :
 * - une question est visible si sa section l'est et si sa propre condition
 *   est vraie (absence de condition = vraie) ;
 * - une condition ne lit que des réponses VALIDES à des questions VISIBLES :
 *   une réponse invalide, ou donnée à une question devenue invisible, compte
 *   comme vide. Masquer une question masque donc en cascade celles qui en
 *   dépendent ;
 * - toute comparaison sur une réponse vide est fausse, sauf `vide`.
 *
 * La définition est validée d'abord (cycles, références inconnues,
 * profondeur) : l'évaluation termine toujours.
 */
import { exigerDefinitionValide } from "./definition";
import {
  lireReponse,
  toutesLesQuestions,
  type Condition,
  type DefinitionQuestionnaire,
  type Question,
  type Reponses,
  type ValeurCondition,
  type ValeurReponse,
} from "./types";
import { validerReponse } from "./valeurs";

/** État calculé d'un questionnaire pour un jeu de réponses. */
export interface EtatQuestionnaire {
  /** Questions visibles, dans l'ordre de la définition. */
  readonly visibles: readonly Question[];
  /** Réponses valides et normalisées aux questions visibles, non vides. */
  readonly valeurs: ReadonlyMap<string, ValeurReponse>;
}

function egale(reponse: ValeurReponse, valeur: ValeurCondition): boolean {
  return Array.isArray(reponse) ? reponse.includes(valeur as string) : reponse === valeur;
}

function compare(reponse: ValeurReponse, valeur: number | string, sens: 1 | -1): boolean {
  if (typeof reponse !== typeof valeur) return false;
  return sens === 1 ? reponse > valeur : reponse < valeur;
}

/** Évalue une condition ; `lire` rend la réponse effective (null si vide ou invisible). */
export function evaluerCondition(
  c: Condition,
  lire: (question: string) => ValeurReponse | null,
): boolean {
  switch (c.op) {
    case "et":
      return c.conditions.every((s) => evaluerCondition(s, lire));
    case "ou":
      return c.conditions.some((s) => evaluerCondition(s, lire));
    case "non":
      return !evaluerCondition(c.condition, lire);
    case "vide":
      return lire(c.question) === null;
  }
  const reponse = lire(c.question);
  if (reponse === null) return false;
  switch (c.op) {
    case "egal":
      return egale(reponse, c.valeur);
    case "different":
      return !egale(reponse, c.valeur);
    case "dans":
      return c.valeurs.some((v) => egale(reponse, v));
    case "superieur":
      return compare(reponse, c.valeur, 1);
    case "inferieur":
      return compare(reponse, c.valeur, -1);
  }
}

/** Calcule les questions visibles et les réponses effectives. */
export function etatQuestionnaire(
  def: DefinitionQuestionnaire,
  reponses: Reponses,
): EtatQuestionnaire {
  exigerDefinitionValide(def);
  const questions = new Map<string, Question>();
  const conditionsSection = new Map<string, Condition | undefined>();
  for (const s of def.sections) {
    for (const q of s.questions) {
      questions.set(q.id, q);
      conditionsSection.set(q.id, s.condition);
    }
  }

  const normalisees = new Map<string, ValeurReponse>();
  for (const q of questions.values()) {
    const r = validerReponse(q, lireReponse(reponses, q.id));
    if (r.valide && r.valeur !== null) normalisees.set(q.id, r.valeur);
  }

  const visibilite = new Map<string, boolean>();
  const lire = (id: string): ValeurReponse | null =>
    estVisible(id) ? (normalisees.get(id) ?? null) : null;
  const estVisible = (id: string): boolean => {
    const connue = visibilite.get(id);
    if (connue !== undefined) return connue;
    const q = questions.get(id) as Question;
    const cs = conditionsSection.get(id);
    const visible =
      (cs === undefined || evaluerCondition(cs, lire)) &&
      (q.condition === undefined || evaluerCondition(q.condition, lire));
    visibilite.set(id, visible);
    return visible;
  };

  const visibles = toutesLesQuestions(def).filter((q) => estVisible(q.id));
  const valeurs = new Map<string, ValeurReponse>();
  for (const q of visibles) {
    const v = normalisees.get(q.id);
    if (v !== undefined) valeurs.set(q.id, v);
  }
  return { visibles, valeurs };
}

/** Identifiants des questions visibles pour ces réponses, dans l'ordre de la définition. */
export function questionsVisibles(def: DefinitionQuestionnaire, reponses: Reponses): string[] {
  return etatQuestionnaire(def, reponses).visibles.map((q) => q.id);
}
