import { ErreurCapitalisation } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs du lot capitalisation (CAP) : SQLSTATE MPJ… des déclencheurs (migrations 0460 à 0465),
 * contraintes (23505, 23503, 23514) et invariants du moteur (`ErreurCapitalisation`). Jamais de
 * 500 pour une règle métier. Codes de l'API : SECURITY.md §6 et §8 sexies.
 */

const SQL: Record<string, [number, string, string]> = {
  MPJ01: [409, "HISTORIQUE_AJOUT_SEUL", "L'historique de la capitalisation est en ajout seul."],
  MPJ02: [409, "RETOUR_VALIDE", "Le retour d'expérience est validé : il ne change plus."],
  MPJ03: [409, "MISSION_CLOTUREE", "La mission est clôturée : les rattachements sont figés."],
  MPJ04: [
    403,
    "SEPARATION_DES_TACHES",
    "Un niveau ne se valide ni par la personne évaluée, ni par son déclarant (sauf associé).",
  ],
  MPJ05: [400, "REQUETE_INVALIDE", "Référence incohérente."],
  MPJ06: [
    409,
    "DECLARATION_EN_ATTENTE",
    "Une déclaration est déjà en attente de décision pour cette compétence.",
  ],
  MPJ07: [
    409,
    "PLAFOND_DECLARATIONS",
    "Au plus 50 déclarations par compétence et par collaborateur.",
  ],
  MPJ08: [
    403,
    "VALIDATION_RESERVEE",
    "Le retour d'expérience se valide par un associé, le chef ou le directeur de la mission.",
  ],
};

const UNICITES: Record<string, [string, string]> = {
  retours_experience_cabinet_id_mission_id_key: [
    "RETOUR_EXISTANT",
    "Un retour d'expérience existe déjà pour cette mission.",
  ],
  retour_experience_versions_retour_id_version_key: [
    "CONFLIT",
    "Une version vient d'être enregistrée : rechargez la page.",
  ],
  competences_cabinet_id_code_key: ["COMPETENCE_EXISTANTE", "Une compétence porte déjà ce code."],
  competence_decisions_declaration_id_key: [
    "DECLARATION_DECIDEE",
    "Cette déclaration a déjà été décidée.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurCapitalisation(error: unknown): unknown {
  if (error instanceof ErreurCapitalisation) {
    return new AppError(400, `CAPITALISATION_${error.code}`, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23505") {
    const u = UNICITES[champ(error, "constraint")];
    if (u) return new AppError(409, u[0], u[1]);
    return new AppError(409, "CONFLIT", "Cette écriture entre en conflit avec une autre.");
  }
  if (code === "23514") return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes.");
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
