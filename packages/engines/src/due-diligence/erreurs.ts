/**
 * Erreurs typées des moteurs de due diligence (service #2, SPEC-3b §5). L'API les traduit en 400
 * (`apps/api/src/due-diligence/erreurs.ts`) : une entrée invalide n'est jamais une erreur interne.
 */

export type CodeErreurDueDiligence =
  | "ENTREE_INVALIDE"
  | "PARAMETRE_INVALIDE"
  | "PARAMETRE_MANQUANT"
  | "BORNES_INCOHERENTES"
  | "DEPASSEMENT"
  | "ARBRE_INVALIDE"
  | "DATE_INVALIDE";

export class ErreurDueDiligence extends Error {
  readonly code: CodeErreurDueDiligence;

  constructor(code: CodeErreurDueDiligence, message: string) {
    super(message);
    this.name = "ErreurDueDiligence";
    this.code = code;
  }
}
