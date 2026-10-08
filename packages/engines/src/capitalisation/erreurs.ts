/**
 * Erreurs typées du moteur de capitalisation (CAP-01, CAP-02, CAP-05, CAP-06).
 * L'API les traduit en 400 (`apps/api/src/capitalisation/erreurs.ts`) : une entrée invalide
 * n'est jamais une erreur interne.
 */

export type CodeErreurCapitalisation =
  | "JOURS_INVALIDES"
  | "CENTIEMES_INVALIDES"
  | "EFFECTIF_MINIMUM_INVALIDE"
  | "SEUIL_INVALIDE"
  | "NIVEAU_INVALIDE";

export class ErreurCapitalisation extends Error {
  readonly code: CodeErreurCapitalisation;

  constructor(code: CodeErreurCapitalisation, message: string) {
    super(message);
    this.name = "ErreurCapitalisation";
    this.code = code;
  }
}
