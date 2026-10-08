import { AppError } from "../errors.js";
import { traduireErreurFacturation } from "../facturation/outils.js";

/** Codes SQLSTATE des déclencheurs de la finance (migrations 0060 à 0063). */
const ERREURS_SQL: Record<string, [number, string, string]> = {
  MPE01: [409, "HISTORIQUE_IMMUABLE", "Historique financier en ajout seul : opération refusée."],
  MPE02: [409, "IMPUTATION_REFUSEE", "Imputation ou contre-passation incohérente."],
  MPE03: [409, "BILAN_FIGE", "Le bilan de clôture est immuable."],
  MPE04: [
    409,
    "DELAI_DEPASSE",
    "Le retour d'expérience se complète dans les 30 jours suivant la clôture.",
  ],
};

/** Erreurs des déclencheurs de la finance, puis de la facturation et des moteurs → 409/400. */
export function traduireErreurFinanceV1(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const sql = ERREURS_SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  return traduireErreurFacturation(error);
}

export const tropPercu = (message: string) => new AppError(409, "TROP_PERCU", message);

/** Conflit réessayable : l'ensemble des imputations a changé pendant l'opération. */
export const imputationsModifiees = () =>
  new AppError(
    409,
    "CONFLIT_CONCURRENT",
    "Les imputations de l'encaissement viennent de changer : réessayer.",
  );
