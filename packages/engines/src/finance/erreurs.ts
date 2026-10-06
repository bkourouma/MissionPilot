/**
 * Erreurs du domaine finance.
 *
 * Toute violation d'invariant (devises différentes, budget figé, pourcentages
 * qui ne somment pas à 100 %…) lève une `ErreurFinance` portant un code
 * stable : l'appelant (API, interface) traduit le code, jamais le message.
 */
export type CodeErreurFinance =
  | "NOMBRE_INVALIDE"
  | "MONTANT_INVALIDE"
  | "DEVISE_DIFFERENTE"
  | "TAUX_CHANGE_INVALIDE"
  | "REPARTITION_INVALIDE"
  | "DATE_INVALIDE"
  | "BUDGET_FIGE"
  | "VERSION_INVALIDE"
  | "TAUX_INCONNU"
  | "POURCENTAGES_INVALIDES"
  | "REMISE_INVALIDE"
  | "AVOIR_INVALIDE"
  | "ECHEANCIER_INVALIDE"
  | "GRILLE_SEUILS_INVALIDE";

export class ErreurFinance extends Error {
  readonly code: CodeErreurFinance;

  constructor(code: CodeErreurFinance, message: string) {
    super(message);
    this.name = "ErreurFinance";
    this.code = code;
  }
}
