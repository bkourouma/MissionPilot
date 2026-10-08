/**
 * Erreurs du domaine questionnaires (SOC-10).
 *
 * Toute violation d'invariant lève une `ErreurQuestionnaire` portant un code
 * stable : l'appelant (API, interface) traduit le code, jamais le message.
 * Les erreurs de validation détaillées (définition, réponses) sont rendues
 * dans `details` pour être affichées question par question.
 */
export type CodeErreurQuestionnaire =
  | "DEFINITION_INVALIDE"
  | "REPONSES_INVALIDES"
  | "DEJA_SOUMISE"
  | "FONCTION_OBLIGATOIRE"
  | "REPONDANT_INVALIDE"
  | "OPTIONS_INVALIDES";

/** Une anomalie localisée : `chemin` désigne l'élément fautif (section, question, condition). */
export interface Anomalie {
  readonly code: string;
  readonly chemin: string;
  readonly message: string;
}

export class ErreurQuestionnaire extends Error {
  readonly code: CodeErreurQuestionnaire;
  readonly details: readonly Anomalie[];

  constructor(code: CodeErreurQuestionnaire, message: string, details: readonly Anomalie[] = []) {
    super(message);
    this.name = "ErreurQuestionnaire";
    this.code = code;
    this.details = details;
  }
}
