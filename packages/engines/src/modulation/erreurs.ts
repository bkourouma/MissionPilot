/**
 * Erreurs du moteur de modulation (STD-04, STD-05).
 *
 * L'application d'un jeu de règles structurellement invalide (forme, bornes,
 * cycle de dépendances) lève une `ErreurModulation` portant un code stable et
 * le chemin fautif : l'appelant traduit le code, jamais le message. La
 * validation (`validerReglesModulation`) dit tout ce qui ne va pas sans lever.
 */
export type CodeErreurModulation =
  "REGLES_INVALIDES" | "CYCLE_REGLES" | "CAS_TYPE_INVALIDE" | "OPTIONS_INVALIDES";

export class ErreurModulation extends Error {
  readonly code: CodeErreurModulation;
  /** Chemin de l'élément fautif (vide si l'erreur porte sur l'ensemble). */
  readonly chemin: string;

  constructor(code: CodeErreurModulation, message: string, chemin = "") {
    super(message);
    this.name = "ErreurModulation";
    this.code = code;
    this.chemin = chemin;
  }
}
