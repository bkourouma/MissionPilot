/**
 * Erreurs des moteurs du dossier client vivant (DOS-02 à DOS-06).
 *
 * Une entrée mal formée (ligne d'état financier incohérente, montant illisible,
 * date invalide, option hors bornes) lève une `ErreurDossier` portant un code
 * stable : l'appelant traduit le code, jamais le message. Un ÉCART de contrôle
 * n'est jamais une erreur : c'est un constat rendu par le moteur.
 */
export type CodeErreurDossier =
  | "LIGNES_INVALIDES"
  | "CODE_LIGNE_INVALIDE"
  | "CODE_LIGNE_EN_DOUBLE"
  | "PARENT_INCONNU"
  | "PARENT_INVALIDE"
  | "CYCLE_PARENTS"
  | "ROLE_INVALIDE"
  | "MONTANT_INVALIDE"
  | "TOLERANCE_INVALIDE"
  | "DATE_INVALIDE"
  | "EVENEMENT_INVALIDE"
  | "OPTIONS_INVALIDES";

export class ErreurDossier extends Error {
  readonly code: CodeErreurDossier;

  constructor(code: CodeErreurDossier, message: string) {
    super(message);
    this.name = "ErreurDossier";
    this.code = code;
  }
}
