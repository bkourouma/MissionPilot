import { ErreurQualite, type ViolationGarde } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs du lot qualité (jamais de 500 pour une règle métier) : SQLSTATE MPY… des déclencheurs
 * (migrations 0280 à 0284), contraintes CHECK (23514), unicité (23505), référence (23503) et
 * invariants du moteur (`ErreurQualite`). Codes d'erreur de l'API : voir SECURITY.md §5 ter.
 */

/** Refus de garde : 409 `GARDE_VIOLEE` avec la liste des violations du moteur (`details`). */
export class ErreurGarde extends AppError {
  constructor(
    message: string,
    readonly violations: readonly ViolationGarde[],
  ) {
    super(409, "GARDE_VIOLEE", message, { violations });
  }
}

const SQL: Record<string, [number, string, string]> = {
  MPY01: [409, "QUALITE_HISTORIQUE_IMMUABLE", "L'historique qualité est en ajout seul."],
  MPY02: [
    409,
    "SUIVI_QUALITE_FIGE",
    "Le suivi qualité n'accepte que le relèvement de la classe et l'avancement du statut.",
  ],
  MPY03: [
    409,
    "SUIVI_QUALITE_VALIDE",
    "Le suivi qualité est validé : le parcours de revue est clos.",
  ],
  MPY04: [409, "SESSION_REVUE_CLOSE", "Cette session de revue est déjà terminée."],
  MPY05: [409, "ETAPE_IMPOSSIBLE", "Cette étape de garde est impossible dans l'état du suivi."],
  MPY06: [409, "SIGNATURE_IMPOSSIBLE", "Signature impossible : le suivi n'est pas validé."],
  MPY07: [409, "RELATION_EN_DOUBLE", "Cette relation est déjà déclarée dans l'autre sens."],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

const UNICITES: Record<string, [string, string]> = {
  qualite_suivis_version_unique: [
    "SUIVI_EXISTANT",
    "Un suivi qualité existe déjà pour cette version du livrable.",
  ],
  qualite_revue_sessions_ouverte_uniq: [
    "SESSION_OUVERTE",
    "Une session de revue est déjà ouverte sur ce livrable.",
  ],
  qualite_acceptations_mission_id_rang_key: [
    "CONFLIT",
    "Une évaluation vient d'être enregistrée : rechargez la page.",
  ],
  qualite_satisfactions_mission_id_cle_rang_key: [
    "CONFLIT",
    "Une note vient d'être enregistrée : rechargez la page.",
  ],
  qualite_relations_unique: ["RELATION_EN_DOUBLE", "Cette relation est déjà déclarée."],
};

export function traduireErreurQualite(error: unknown): unknown {
  if (error instanceof ErreurQualite)
    return new AppError(400, `QUALITE_${error.code}`, error.message);
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23505") {
    const u = UNICITES[champ(error, "constraint")];
    if (u) return new AppError(409, u[0], u[1]);
    return new AppError(409, "CONFLIT", "Cette écriture entre en conflit avec une autre.");
  }
  if (code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour ce suivi qualité.");
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
