/**
 * Erreurs du moteur du registre des preuves (PRV-02 à PRV-05).
 *
 * Une entrée mal formée (type de source ou fiabilité inconnus, identifiant
 * absent ou en double, options hors bornes) lève une `ErreurPreuves` portant
 * un code stable : l'appelant traduit le code, jamais le message.
 */
export type CodeErreurPreuves =
  "PREUVE_INVALIDE" | "ASSERTION_INVALIDE" | "DIMENSION_INVALIDE" | "OPTIONS_INVALIDES";

export class ErreurPreuves extends Error {
  readonly code: CodeErreurPreuves;

  constructor(code: CodeErreurPreuves, message: string) {
    super(message);
    this.name = "ErreurPreuves";
    this.code = code;
  }
}
