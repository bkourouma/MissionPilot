import { AppError } from "../errors.js";
import { traduireErreurAppelsOffres } from "./erreurs.js";

/*
 * Traduction des erreurs de la veille des appels d'offres (AO-01) en erreurs HTTP : SQLSTATE
 * MQA… des déclencheurs (migrations 0364 à 0367), puis traduction des appels d'offres
 * (contraintes, `ErreurAppelsOffres`) pour le reste. Jamais de 500 pour une règle métier.
 */

const SQL: Record<string, [number, string, string]> = {
  MQA01: [
    409,
    "AO_VEILLE_HISTORIQUE_IMMUABLE",
    "L'historique de la veille est en ajout seul : il ne se modifie pas.",
  ],
  MQA02: [409, "AO_VEILLE_TRANSITION_REFUSEE", "Ce changement de statut n'est pas admis."],
  MQA03: [
    409,
    "AO_VEILLE_PLAFOND",
    "Le plafond de résultats de veille du cabinet est atteint (5 000).",
  ],
  MQA04: [409, "AO_VEILLE_PLAFOND_OCCURRENCES", "Trop d'occurrences pour cet avis."],
  MQA05: [
    409,
    "AO_VEILLE_DECISION_INCOHERENTE",
    "Cette décision ne convient pas à l'état actuel du résultat.",
  ],
};

export function traduireErreurVeille(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  return traduireErreurAppelsOffres(error);
}
