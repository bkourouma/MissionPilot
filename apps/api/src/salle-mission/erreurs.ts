import { AppError } from "../errors.js";

/*
 * Traduction des SQLSTATE de la salle de mission (migrations 0330 et 0332, lettre L ; CHECK 23514) et des conflits
 * d'écriture concurrente. Les messages des déclencheurs sont des textes fixes, en français et
 * sans donnée : ils sont rendus tels quels.
 */

const CODES: Record<string, [number, string]> = {
  MPL01: [409, "HISTORIQUE_IMMUABLE"],
  MPL02: [409, "TRANSITION_REFUSEE"],
  MPL03: [409, "DEPOT_REFUSE"],
  MPL04: [400, "REQUETE_INVALIDE"],
  MPL05: [409, "DEMANDE_FIGEE"],
  MPL06: [409, "MISSION_CLOTUREE"],
  MPL07: [409, "DEPOTS_PLAFOND"],
  MPL08: [429, "DEPOTS_TROP_RAPIDES"],
  MPL09: [409, "ACCEPTATION_PAR_DEPOSANT"],
};

const CONTRAINTES_CONCURRENTES = new Set([
  "salle_piece_evenements_piece_id_rang_key",
  "salle_relances_palier_uniq",
  "salle_depots_fichier_id_key",
]);

/** Erreur PostgreSQL de la salle de mission → AppError ; toute autre erreur est rendue telle quelle. */
export function traduireErreurSalle(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  const e = error as { code?: string; message?: string; constraint?: string };
  const code = CODES[e.code ?? ""];
  if (code) return new AppError(code[0], code[1], e.message ?? "Opération refusée.");
  // CHECK de 0330 (date hors 2000-2100, taille des pièces d'un modèle) : jamais un 500.
  if (e.code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeur refusée par les contrôles de la base.");
  }
  if (e.code === "23505" && CONTRAINTES_CONCURRENTES.has(e.constraint ?? "")) {
    return new AppError(
      409,
      "CONFLIT",
      "Une autre modification vient d'être enregistrée : rechargez puis réessayez.",
    );
  }
  return error;
}
