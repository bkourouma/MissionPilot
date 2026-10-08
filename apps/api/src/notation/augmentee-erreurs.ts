import { ErreurNotationAugmentee } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs de la notation augmentée (NOT-09 à NOT-13, NOT-17) en erreurs HTTP,
 * jamais de 500 pour une règle métier : invariants du moteur (`ErreurNotationAugmentee`, code
 * stable, anomalies dans `details.erreurs`), SQLSTATE MPN04 et MPN08 à MPN12 des migrations
 * 0400 à 0403, unicité (23505), référence (23503) et contrainte CHECK (23514, 400).
 */

const SQL: Record<string, [number, string, string]> = {
  MPN04: [
    403,
    "SEPARATION_DES_TACHES",
    "L'auteur ou le dernier modificateur ne valide pas : un autre expert métier doit relire.",
  ],
  MPN08: [409, "ITEM_FIGE", "Un item validé de la banque est figé : créez une nouvelle version."],
  MPN09: [
    409,
    "SELECTION_REFUSEE",
    "Une sélection ne cite que des items validés de la banque et leurs formulations validées.",
  ],
  MPN10: [
    409,
    "CONFIANCE_INSUFFISANTE",
    "L'indice de confiance de cette version est sous le seuil du cabinet : publication refusée.",
  ],
  MPN11: [409, "CALIBRATION_FIGEE", "Cette session de calibrage n'accepte pas cette écriture."],
  MPN12: [
    409,
    "PLAN_ACTION_INCOHERENT",
    "Écriture refusée sur la bibliothèque ou le plan d'action.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurNotationAugmentee(error: unknown): unknown {
  if (error instanceof ErreurNotationAugmentee) {
    const statut = error.code === "NOTE_NON_NOTABLE" ? 409 : 400;
    return new AppError(
      statut,
      error.code,
      error.message,
      error.details.length > 0 ? { erreurs: error.details } : undefined,
    );
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23505") return new AppError(409, "CONFLIT", "Cet élément existe déjà.");
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  // CHECK : valeur hors bornes que le schéma n'a pas arrêtée (jamais un 500 pour une saisie).
  if (code === "23514")
    return new AppError(400, "REQUETE_INVALIDE", "Valeur hors des bornes admises.");
  return error;
}
