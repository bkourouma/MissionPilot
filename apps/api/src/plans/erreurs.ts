import { ErreurPlan } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/** SQLSTATE des déclencheurs du plan stratégique (migrations 0180 à 0184, 0420 à 0423). */
const SQL_AJOUT_SEUL = "MPS01";
const SQL_INCOHERENT = "MPS02";
const SQL_SEPARATION = "MPS03";
const SQL_PARTAGE = "MPS04";
const SQL_PLAFOND = "MPS05";
const SQL_NOTATION = "MPS06";
const SQL_BIBLIOTHEQUE = "MPS07";
const SQL_ARBITRAGE = "MPS08";

/**
 * Traduit les erreurs du moteur de plan et des déclencheurs en erreurs HTTP :
 * hypothèse refusée par le moteur → 400 avec son code (le client traduit le
 * code ; le message cite le chemin de l'hypothèse) ; historique en ajout
 * seul ou incohérence → 409 ; séparation des tâches → 403 ; partage d'un
 * contenu non validé → 409 ; plafond de versions du modèle (ou de
 * l'historique d'un lien) → 409 ; notation liée non publiée ou d'un autre
 * client → 409 ; bibliothèque d'initiatives incohérente (variante, propriétaire,
 * version) → 409 ; arbitrage du portefeuille incohérent (retenue hors plan,
 * écart sans motif) → 409 ; contrainte CHECK (23514) → 400. Le reste remonte au gestionnaire de l'application.
 */
export function traduireErreurPlan(error: unknown): unknown {
  if (error instanceof ErreurPlan) return new AppError(400, error.code, error.message);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case SQL_AJOUT_SEUL:
      return new AppError(409, "PLAN_AJOUT_SEUL", "Le plan s'enrichit par nouvelles versions.");
    case SQL_INCOHERENT:
      return new AppError(409, "PLAN_INCOHERENT", "Opération incohérente avec l'état du plan.");
    case SQL_SEPARATION:
      return new AppError(
        403,
        "VALIDATION_REQUISE",
        "L'auteur d'un contenu ne le valide pas lui-même : la faire valider par un autre responsable.",
      );
    case SQL_PARTAGE:
      return new AppError(
        409,
        "CONTENU_NON_VALIDE",
        "Partage refusé : tout le contenu du plan doit être validé.",
      );
    case SQL_PLAFOND:
      return new AppError(
        409,
        "PLAN_PLAFOND_VERSIONS",
        "Ce plan a atteint le nombre maximal de versions pour cet historique.",
      );
    case SQL_NOTATION:
      return new AppError(
        409,
        "NOTATION_NON_PUBLIEE",
        "Seule une notation publiée du même client se lie au diagnostic du plan.",
      );
    case SQL_BIBLIOTHEQUE:
      return new AppError(
        409,
        "BIBLIOTHEQUE_INCOHERENTE",
        "Opération incohérente avec la bibliothèque d'initiatives.",
      );
    case SQL_ARBITRAGE:
      return new AppError(
        409,
        "ARBITRAGE_INCOHERENT",
        "Arbitrage refusé : initiatives du plan et motif de chaque écart attendus.",
      );
    case "23514":
      // CHECK (dates hors 2000-2100, bornes de colonnes…) que le schéma n'a pas arrêté : jamais 500.
      return new AppError(400, "REQUETE_INVALIDE", "Valeur hors des bornes admises.");
    default:
      return error;
  }
}
