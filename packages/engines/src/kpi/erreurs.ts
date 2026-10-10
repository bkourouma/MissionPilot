/**
 * Erreurs du domaine pilotage par KPI (service 4, KPI-01 à KPI-04).
 *
 * Toute violation d'invariant lève une `ErreurKpi` portant un code stable :
 * l'appelant (API, interface) traduit le code, jamais le message.
 */
export type CodeErreurKpi =
  | "NOMBRE_INVALIDE"
  | "SEUILS_INVALIDES"
  | "BORNES_INVALIDES"
  | "DATE_INVALIDE"
  | "PERIODE_INVALIDE"
  | "MESURES_AMBIGUES"
  | "PONDERATION_INVALIDE"
  | "KPI_EN_DOUBLE"
  | "OPTIONS_INVALIDES"
  | "ARBRE_INVALIDE"
  | "ARBRE_UNITES";

export class ErreurKpi extends Error {
  readonly code: CodeErreurKpi;

  constructor(code: CodeErreurKpi, message: string) {
    super(message);
    this.name = "ErreurKpi";
    this.code = code;
  }
}
