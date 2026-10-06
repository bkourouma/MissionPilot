/**
 * Moteur de questionnaires (SOC-10) : définition en données pures, logique
 * conditionnelle, validation des réponses, progression, modes individuel,
 * collectif et par fonction, écarts entre répondants (NOT-05 déterministe).
 * Fonctions pures, déterministes, sans base, sans réseau ni horloge.
 */
export { ErreurQuestionnaire, type Anomalie, type CodeErreurQuestionnaire } from "./erreurs";
export {
  FORMAT_IDENTIFIANT,
  PROFONDEUR_MAX_CONDITION,
  POINTS_LIKERT_MIN,
  POINTS_LIKERT_MAX,
  LONGUEUR_TEXTE_DEFAUT,
  LONGUEUR_TEXTE_PLAFOND,
  lireReponse,
  estVide,
  toutesLesQuestions,
  type TypeQuestion,
  type ValeurCondition,
  type Condition,
  type QuestionLikert,
  type OptionChoix,
  type QuestionChoixUnique,
  type QuestionChoixMultiple,
  type QuestionTexte,
  type QuestionNumerique,
  type QuestionOuiNon,
  type QuestionDate,
  type Question,
  type Section,
  type DefinitionQuestionnaire,
  type ValeurReponse,
  type Reponses,
} from "./types";
export {
  validerReponse,
  type CodeReponseInvalide,
  type ResultatValidationReponse,
} from "./valeurs";
export {
  validerDefinition,
  exigerDefinitionValide,
  profondeurCondition,
  referencesCondition,
  type ResultatValidationDefinition,
} from "./definition";
export {
  evaluerCondition,
  etatQuestionnaire,
  questionsVisibles,
  type EtatQuestionnaire,
} from "./visibilite";
export {
  validerReponses,
  exigerReponsesValides,
  progression,
  type ModeValidation,
  type ReponseEcartee,
  type ResultatValidationReponses,
  type Progression,
} from "./reponses";
export {
  validerRepondants,
  creerReponseCollective,
  fusionnerReponses,
  soumettreReponses,
  type ModeQuestionnaire,
  type Repondant,
  type Signature,
  type Contribution,
  type ReponseCollective,
} from "./collectif";
export {
  detecterEcarts,
  SEUIL_ECART_DEFAUT,
  type ReponsesRepondant,
  type EcartRepondants,
} from "./incoherences";
