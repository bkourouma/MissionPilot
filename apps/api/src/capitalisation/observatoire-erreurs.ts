import { ErreurObservatoire } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs de l'observatoire (CAP-04) : SQLSTATE MQK20 à MQK27 des déclencheurs et de la fonction
 * `obs_agregats` (migrations 0470 à 0472), contraintes (23505, 23514, 23503) et invariants du
 * moteur (`ErreurObservatoire`). Jamais de 500 pour une règle métier.
 */

export const reserveAdherents = () =>
  new AppError(
    403,
    "OBSERVATOIRE_RESERVE_ADHERENTS",
    "L'observatoire est réservé aux cabinets adhérents : adhérez et versez vos données pour y accéder.",
  );
export const adhesionInactive = () =>
  new AppError(
    409,
    "OBSERVATOIRE_ADHESION_INACTIVE",
    "Le cabinet n'adhère pas à l'observatoire : aucun versement n'est possible.",
  );
export const dejaAdherent = () =>
  new AppError(409, "OBSERVATOIRE_DEJA_ADHERENT", "Le cabinet adhère déjà à l'observatoire.");
export const nonAdherent = () =>
  new AppError(409, "OBSERVATOIRE_NON_ADHERENT", "Le cabinet n'adhère pas à l'observatoire.");

export const contributionRequise = () =>
  new AppError(
    403,
    "OBSERVATOIRE_CONTRIBUTION_REQUISE",
    "Versez d'abord vos données pour consulter l'observatoire (elles sont prises en compte au mois suivant).",
  );

const SQL: Record<string, () => AppError> = {
  MQK20: () =>
    new AppError(409, "HISTORIQUE_AJOUT_SEUL", "L'historique d'adhésion est en ajout seul."),
  MQK21: () =>
    new AppError(
      409,
      "OBSERVATOIRE_TRANSITION_REFUSEE",
      "Cette transition d'adhésion n'est pas possible dans l'état actuel.",
    ),
  MQK22: adhesionInactive,
  MQK23: () =>
    new AppError(409, "OBSERVATOIRE_CONTRIBUTION_IMMUABLE", "Une contribution ne se modifie pas."),
  MQK24: () => new AppError(403, "INTERDIT", "Vous n'avez pas le droit d'effectuer cette action."),
  MQK25: reserveAdherents,
  MQK27: contributionRequise,
  MQK26: () => new AppError(400, "REQUETE_INVALIDE", "Indicateur de l'observatoire inconnu."),
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurObservatoire(error: unknown): unknown {
  if (error instanceof ErreurObservatoire) {
    return new AppError(400, `OBSERVATOIRE_${error.code}`, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return sql();
  if (code === "23505") {
    return new AppError(409, "CONFLIT", "Une écriture concurrente vient d'avoir lieu : réessayez.");
  }
  if (code === "23514") return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes.");
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
