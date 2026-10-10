/**
 * Erreurs de la notation augmentée (PRD complémentaire §11.1, NOT-09 à NOT-13 et NOT-17) :
 * banque d'items, sélection adaptative, constats de perception, indice de confiance,
 * explicabilité, calibration et plan d'action. Code stable : l'appelant traduit le code,
 * jamais le message ; les anomalies détaillées sont rendues dans `details`.
 */
export type CodeErreurNotationAugmentee =
  | "ITEM_INVALIDE"
  | "SELECTION_INVALIDE"
  | "OPTIONS_INVALIDES"
  | "NOTE_NON_NOTABLE"
  | "COTATIONS_INVALIDES"
  | "INITIATIVES_INVALIDES";

export interface AnomalieNotationAugmentee {
  readonly code: string;
  readonly chemin: string;
  readonly message: string;
}

export class ErreurNotationAugmentee extends Error {
  readonly code: CodeErreurNotationAugmentee;
  readonly details: readonly AnomalieNotationAugmentee[];

  constructor(
    code: CodeErreurNotationAugmentee,
    message: string,
    details: readonly AnomalieNotationAugmentee[] = [],
  ) {
    super(message);
    this.name = "ErreurNotationAugmentee";
    this.code = code;
    this.details = details;
  }
}
