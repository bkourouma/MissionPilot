import { ErreurEfficacite } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs de l'efficacité des recommandations (CAP-03) : SQLSTATE MQK01 à MQK05 des déclencheurs
 * (migrations 0466 et 0467), unicité et invariants du moteur (`ErreurEfficacite`). Jamais de 500
 * pour une règle métier.
 */

const SQL: Record<string, [number, string, string]> = {
  MQK01: [409, "HISTORIQUE_AJOUT_SEUL", "L'historique d'efficacité est en ajout seul."],
  MQK02: [
    400,
    "REQUETE_INVALIDE",
    "Le KPI et l'initiative doivent appartenir à la mission de la recommandation.",
  ],
  MQK03: [409, "IDENTITE_FIGEE", "L'identité d'une recommandation est figée."],
  MQK04: [409, "TRANSITION_INTERDITE", "Cette recommandation ne peut pas changer de statut ainsi."],
  MQK05: [
    409,
    "NON_MISE_EN_OEUVRE",
    "L'effet ne se mesure que pour une recommandation mise en oeuvre.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurEfficacite(error: unknown): unknown {
  if (error instanceof ErreurEfficacite) {
    return new AppError(400, `EFFICACITE_${error.code}`, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23505") {
    if (champ(error, "constraint") === "cap_recommandations_cabinet_id_mission_id_kpi_id_key") {
      return new AppError(
        409,
        "RECOMMANDATION_EXISTANTE",
        "Une recommandation existe déjà pour ce KPI de cette mission.",
      );
    }
    return new AppError(409, "CONFLIT", "Cette écriture entre en conflit avec une autre.");
  }
  if (code === "23514") return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes.");
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
