/**
 * Erreurs du moteur de qualité (QUA-01 à QUA-04).
 *
 * Une entrée mal formée (classe ou étape inconnue, acteur vide) lève une
 * `ErreurQualite` portant un code stable : l'appelant traduit le code, jamais
 * le message. Une garde incomplète n'est PAS une erreur : `evaluerGarde` le
 * dit dans son résultat.
 */
export type CodeErreurQualite = "CLASSE_INVALIDE" | "VALIDATION_INVALIDE" | "OPTIONS_INVALIDES";

export class ErreurQualite extends Error {
  readonly code: CodeErreurQualite;

  constructor(code: CodeErreurQualite, message: string) {
    super(message);
    this.name = "ErreurQualite";
    this.code = code;
  }
}
