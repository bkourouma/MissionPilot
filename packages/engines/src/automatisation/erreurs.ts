/**
 * Erreurs du moteur d'automatisation (AUT-01 à AUT-06). Une entrée mal formée lève une
 * `ErreurAutomatisation` portant un code stable : l'appelant traduit le code, jamais le
 * message.
 */
export type CodeErreurAutomatisation =
  "CONDITION_INVALIDE" | "DEFINITION_INVALIDE" | "ENTREE_INVALIDE";

export class ErreurAutomatisation extends Error {
  readonly code: CodeErreurAutomatisation;

  constructor(code: CodeErreurAutomatisation, message: string) {
    super(message);
    this.name = "ErreurAutomatisation";
    this.code = code;
  }
}
