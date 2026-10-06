/**
 * Erreurs du domaine notation (service 1, NOT-01 à NOT-08).
 *
 * Toute violation d'invariant lève une `ErreurNotation` portant un code
 * stable : l'appelant traduit le code, jamais le message. Les anomalies
 * d'une grille sont rendues dans `details`.
 */
export type CodeErreurNotation =
  | "NOMBRE_INVALIDE"
  | "GRILLE_INVALIDE"
  | "REPONSE_INCOMPATIBLE"
  | "SCORE_INVALIDE"
  | "OPTIONS_INVALIDES"
  | "AJUSTEMENT_INVALIDE"
  | "DIMENSION_INCONNUE"
  | "DIMENSION_NON_NOTABLE"
  | "REPONDANT_INVALIDE";

export interface AnomalieGrille {
  readonly code: string;
  readonly chemin: string;
  readonly message: string;
}

export class ErreurNotation extends Error {
  readonly code: CodeErreurNotation;
  readonly details: readonly AnomalieGrille[];

  constructor(code: CodeErreurNotation, message: string, details: readonly AnomalieGrille[] = []) {
    super(message);
    this.name = "ErreurNotation";
    this.code = code;
    this.details = details;
  }
}
