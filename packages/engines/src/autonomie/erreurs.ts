/**
 * Erreurs du moteur des niveaux d'autonomie (AGT-03).
 *
 * Une entrée mal formée (niveau ou classe inconnus, compteurs négatifs, date
 * invalide) lève une `ErreurAutonomie` portant un code stable : l'appelant
 * traduit le code, jamais le message.
 */
export type CodeErreurAutonomie =
  | "NIVEAU_INVALIDE"
  | "CLASSE_INVALIDE"
  | "STATISTIQUES_INVALIDES"
  | "DATE_INVALIDE"
  | "OPTIONS_INVALIDES";

export class ErreurAutonomie extends Error {
  readonly code: CodeErreurAutonomie;

  constructor(code: CodeErreurAutonomie, message: string) {
    super(message);
    this.name = "ErreurAutonomie";
    this.code = code;
  }
}
