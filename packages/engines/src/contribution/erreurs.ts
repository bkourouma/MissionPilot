/**
 * Erreurs du moteur de contribution de l'IA (AGT-05).
 *
 * Une entrée mal formée (texte absent ou trop long, durée négative, seuil
 * hors bornes) lève une `ErreurContribution` portant un code stable :
 * l'appelant traduit le code, jamais le message.
 */
export type CodeErreurContribution =
  "TEXTE_INVALIDE" | "TEXTE_TROP_LONG" | "DUREE_INVALIDE" | "OPTIONS_INVALIDES";

export class ErreurContribution extends Error {
  readonly code: CodeErreurContribution;

  constructor(code: CodeErreurContribution, message: string) {
    super(message);
    this.name = "ErreurContribution";
    this.code = code;
  }
}
