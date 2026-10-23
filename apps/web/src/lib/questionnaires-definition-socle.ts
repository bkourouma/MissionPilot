/** Sous-module de `questionnaires-definition.ts` : types, bornes et types de questions. */
import {
  ECHELLE_ACCORD,
  ECHELLE_MATURITE,
  type ConditionAffichage,
  type DefinitionQuestionnaireDonnees,
  type QuestionQuestionnaire,
  type SectionQuestionnaire,
} from "@missionpilot/shared";

export type Definition = DefinitionQuestionnaireDonnees;
export type Section = SectionQuestionnaire;
export type Question = QuestionQuestionnaire;
export type Condition = ConditionAffichage;
export type TypeQuestion = Question["type"];
export type OperateurCondition = Condition["op"];
export type OptionChoix = Extract<Question, { type: "choix_unique" }>["options"][number];
/** Condition élémentaire : comparaison de la réponse à une question. */
export type Comparaison = Exclude<Condition, { op: "et" | "ou" | "non" }>;

/** Anomalie localisée : même forme que celles du moteur (`code`, `chemin`, `message`). */
export interface Anomalie {
  code: string;
  chemin: string;
  message: string;
}

/** Bornes du schéma et du moteur (`packages/engines/src/questionnaires/types.ts`). */
export const PROFONDEUR_MAX_CONDITION = 5;
export const POINTS_LIKERT_MIN = 2;
export const POINTS_LIKERT_MAX = 10;
export const LONGUEUR_TEXTE_DEFAUT = 2_000;
export const LONGUEUR_TEXTE_PLAFOND = 20_000;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 50;

/** Espace insécable (U+00A0) entre une valeur et son unité, comme `lib/format.ts`. */
export const ESPACE_INSECABLE = String.fromCharCode(0xa0);

// --- Types de questions -----------------------------------------------------------------------

/** Types définis par le schéma, plus « pourcentage » (nombre de 0 à 100 %, unité « % »). */
export const MODELES_QUESTION = [
  "likert",
  "choix_unique",
  "choix_multiple",
  "oui_non",
  "pourcentage",
  "numerique",
  "texte",
  "date",
] as const;
export type ModeleQuestion = (typeof MODELES_QUESTION)[number];

export const MODELE_QUESTION: Record<ModeleQuestion, { libelle: string; aide: string }> = {
  likert: {
    libelle: "Échelle (Likert)",
    aide: "De 2 à 10 niveaux libellés, ex. de « Pas du tout d'accord » à « Tout à fait d'accord ».",
  },
  choix_unique: { libelle: "Choix unique", aide: "Une seule réponse parmi les options proposées." },
  choix_multiple: {
    libelle: "Choix multiple",
    aide: "Plusieurs réponses possibles, avec un minimum et un maximum.",
  },
  oui_non: { libelle: "Oui / non", aide: "Réponse binaire." },
  pourcentage: { libelle: "Pourcentage", aide: "Nombre de 0 à 100 %." },
  numerique: { libelle: "Nombre", aide: "Valeur numérique, avec bornes et unité facultatives." },
  texte: { libelle: "Texte libre", aide: "Réponse rédigée, longueur maximale réglable." },
  date: { libelle: "Date", aide: "Date, avec bornes facultatives." },
};

export const estModeleQuestion = (v: string): v is ModeleQuestion =>
  (MODELES_QUESTION as readonly string[]).includes(v);

/** « pourcentage » est une question numérique de 0 à 100 d'unité « % ». */
export function modeleDeQuestion(q: Question): ModeleQuestion {
  if (q.type === "numerique" && q.unite === "%" && q.min === 0 && q.max === 100) {
    return "pourcentage";
  }
  return q.type;
}

/** Échelles de départ proposées pour une question de Likert (5 niveaux). */
export const ECHELLES_TYPES = [
  { id: "accord", libelle: "Échelle d'accord", niveaux: ECHELLE_ACCORD },
  { id: "maturite", libelle: "Échelle de maturité", niveaux: ECHELLE_MATURITE },
] as const;
