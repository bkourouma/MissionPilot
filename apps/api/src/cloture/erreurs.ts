import { AppError } from "../errors.js";

/*
 * Traduction des SQLSTATE de la check-list de clôture (migrations 0321 à 0323, lettre X) :
 * jamais de 500 pour une règle métier. Messages fixes, en français, sans donnée.
 */

const CODES: Record<string, [number, string, string]> = {
  MPX01: [
    409,
    "CLOTURE_HISTORIQUE_IMMUABLE",
    "L'historique de clôture est en ajout seul : ajouter une nouvelle ligne.",
  ],
  MPX02: [
    403,
    "DEROGATION_ROLE_REQUIS",
    "Une dérogation de clôture est réservée à un directeur de mission ou à un associé.",
  ],
  MPX03: [
    409,
    "DEROGATION_PAR_CLOTUREUR",
    "Séparation des tâches : celui qui a accordé une dérogation ne clôt pas la mission (sauf associé).",
  ],
};

/** Erreur PostgreSQL de la clôture → AppError ; toute autre erreur est rendue telle quelle. */
export function traduireErreurCloture(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  const e = error as { code?: string };
  const t = CODES[e.code ?? ""];
  if (t) return new AppError(t[0], t[1], t[2]);
  if (e.code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeur refusée par les contrôles de la base.");
  }
  return error;
}
