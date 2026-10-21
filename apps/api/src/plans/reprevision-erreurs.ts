import { AppError } from "../errors.js";

/** SQLSTATE du plan vivant (migrations 0430 et 0431, plage MQL15 à MQL24). */
const SQL_REALISE_AJOUT_SEUL = "MQL15";
const SQL_REALISE_VERSION = "MQL16";
const SQL_REALISE_PLAFOND = "MQL17";
const SQL_REALISE_TRIMESTRE = "MQL18";
const SQL_REPREVISION_AJOUT_SEUL = "MQL19";
const SQL_REPREVISION_AUTRE_PLAN = "MQL20";
const SQL_REPREVISION_NON_VALIDEE = "MQL21";
const SQL_REPREVISION_VERSION = "MQL22";
const SQL_REPREVISION_PLAFOND = "MQL23";
const SQL_REPREVISION_INCOHERENTE = "MQL24";

/**
 * Traduit les violations des déclencheurs du plan vivant en erreurs HTTP, jamais en 500 :
 * historique en ajout seul, version non séquentielle, plafond, version du modèle d'un autre plan,
 * non validée ou résultat incohérent → 409 ; trimestre saisi hors ordre → 400. Les messages ne
 * citent aucun montant. Toute autre erreur est rendue telle quelle (à chaîner avec
 * `traduireErreurPlan`, qui traduit les erreurs du moteur en 400).
 */
export function traduireErreurReprevision(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case SQL_REALISE_AJOUT_SEUL:
      return new AppError(
        409,
        "REALISE_AJOUT_SEUL",
        "Un réalisé enregistré ne se modifie pas : saisir une nouvelle version.",
      );
    case SQL_REALISE_VERSION:
      return new AppError(
        409,
        "REALISE_VERSION_CONFLIT",
        "Le réalisé a changé entre-temps : recharger puis recommencer.",
      );
    case SQL_REALISE_PLAFOND:
      return new AppError(
        409,
        "REALISES_PLAFOND",
        "Le nombre maximal de versions de réalisés est atteint pour ce trimestre ou ce plan.",
      );
    case SQL_REALISE_TRIMESTRE:
      return new AppError(
        400,
        "REALISE_TRIMESTRE_NON_CONSECUTIF",
        "Les trimestres se saisissent dans l'ordre, sans trou : saisir d'abord le trimestre précédent.",
      );
    case SQL_REPREVISION_AJOUT_SEUL:
      return new AppError(
        409,
        "REPREVISION_AJOUT_SEUL",
        "Une re-prévision enregistrée ne se modifie pas : en lancer une nouvelle.",
      );
    case SQL_REPREVISION_AUTRE_PLAN:
      return new AppError(
        409,
        "REPREVISION_VERSION_INCOHERENTE",
        "La version du modèle financier n'appartient pas à ce plan.",
      );
    case SQL_REPREVISION_NON_VALIDEE:
      return new AppError(
        409,
        "MODELE_NON_VALIDE",
        "La re-prévision se calcule sur une version validée du modèle financier.",
      );
    case SQL_REPREVISION_VERSION:
      return new AppError(
        409,
        "REPREVISION_VERSION_CONFLIT",
        "Une re-prévision vient d'être enregistrée : recharger puis recommencer.",
      );
    case SQL_REPREVISION_PLAFOND:
      return new AppError(
        409,
        "REPREVISIONS_PLAFOND",
        "Cet exercice a atteint le nombre maximal de re-prévisions enregistrées.",
      );
    case SQL_REPREVISION_INCOHERENTE:
      return new AppError(
        409,
        "REPREVISION_INCOHERENTE",
        "Re-prévision incohérente avec ses entrées ou son résultat.",
      );
    default:
      return error;
  }
}
