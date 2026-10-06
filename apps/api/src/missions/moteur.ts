import { CycleDependancesError, ErreurFinance } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/** Codes SQLSTATE levés par les déclencheurs d'immuabilité (migrations 0010, 0011, 0013). */
const SQL_BUDGET_FIGE = "MPF01";
const SQL_PROPOSITION_FIGEE = "MPF02";

/**
 * Traduit les erreurs des moteurs et des déclencheurs en erreurs HTTP :
 * budget figé → 409 BUDGET_FIGE, cycle de dépendances → 409, autre invariant
 * financier → 400 avec le code du moteur (le client traduit le code).
 */
export function traduireErreurMoteur(error: unknown): unknown {
  if (error instanceof ErreurFinance) {
    if (error.code === "BUDGET_FIGE") return new AppError(409, "BUDGET_FIGE", error.message);
    return new AppError(400, error.code, error.message);
  }
  if (error instanceof CycleDependancesError) {
    return new AppError(409, "CYCLE_DEPENDANCES", "Ces dépendances formeraient un cycle.");
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === SQL_BUDGET_FIGE) {
    return new AppError(409, "BUDGET_FIGE", "Le budget signé est figé : créer une révision.");
  }
  if (code === SQL_PROPOSITION_FIGEE) {
    return new AppError(409, "PROPOSITION_FIGEE", "La proposition validée est figée.");
  }
  return error;
}
