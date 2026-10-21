import { AppError } from "../errors.js";

/** SQLSTATE de la simulation de Monte-Carlo (migration 0429, plage MQL10 à MQL14). */
const SQL_AJOUT_SEUL = "MQL10";
const SQL_VERSION_AUTRE_PLAN = "MQL11";
const SQL_PLAFOND_PLAN = "MQL12";
const SQL_INCOHERENT = "MQL13";
const SQL_DEBIT = "MQL14";

/**
 * Traduit les violations des déclencheurs de la simulation de Monte-Carlo en
 * erreurs HTTP : historique en ajout seul, version du modèle d'un autre plan,
 * plafond par plan ou résultat incohérent → 409 ; plafond de débit → 429.
 * Toute autre erreur est rendue telle quelle (à chaîner avec
 * `traduireErreurPlan`, qui traduit les erreurs du moteur en 400).
 */
export function traduireErreurMonteCarlo(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case SQL_AJOUT_SEUL:
      return new AppError(
        409,
        "SIMULATION_AJOUT_SEUL",
        "Une simulation enregistrée ne se modifie pas : en lancer une nouvelle.",
      );
    case SQL_VERSION_AUTRE_PLAN:
      return new AppError(
        409,
        "SIMULATION_VERSION_INCOHERENTE",
        "La version du modèle financier n'appartient pas à ce plan.",
      );
    case SQL_PLAFOND_PLAN:
      return new AppError(
        409,
        "SIMULATIONS_PLAFOND",
        "Ce plan a atteint le nombre maximal de simulations enregistrées.",
      );
    case SQL_INCOHERENT:
      return new AppError(
        409,
        "SIMULATION_INCOHERENTE",
        "Résultat de simulation incohérent avec la graine ou les tirages.",
      );
    case SQL_DEBIT:
      return new AppError(
        429,
        "TROP_DE_SIMULATIONS",
        "Trop de simulations lancées récemment : réessayez plus tard.",
      );
    default:
      return error;
  }
}
