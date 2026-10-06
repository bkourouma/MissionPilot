import { ErreurNotation, ErreurQuestionnaire } from "@missionpilot/engines";
import { ZodError, type ZodIssue } from "zod";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs des moteurs (questionnaires, notation) et des
 * déclencheurs (migrations 0140 à 0147) en erreurs HTTP. Les anomalies
 * détaillées d'un moteur (question par question, chemin dans la grille)
 * passent par une ZodError : le gestionnaire unique d'app.ts les rend en 400
 * REQUETE_INVALIDE avec `details` (fieldErrors indexés par chemin). Messages
 * fixes pour les SQLSTATE : jamais le texte brut de PostgreSQL.
 */

const SQL: Record<string, [number, string, string]> = {
  MPQ01: [
    409,
    "QUESTIONNAIRE_VERSION_FIGEE",
    "Cette version est validée : elle est figée, créez une nouvelle version.",
  ],
  MPQ02: [409, "ENVOI_FIGE", "Cet envoi de questionnaire ne peut plus être modifié ainsi."],
  MPQ03: [
    400,
    "REPONDANT_INVALIDE",
    "Répondant invalide : un dirigeant ou un contributeur actif du client de la mission est attendu.",
  ],
  MPQ04: [409, "REPONSE_VERROUILLEE", "Cette réponse ne peut plus être modifiée."],
  MPQ05: [409, "HISTORIQUE_IMMUABLE", "L'historique des relances est en ajout seul."],
  MPN01: [
    409,
    "NOTATION_IMMUABLE",
    "L'historique de notation est en ajout seul : lancez un nouveau calcul.",
  ],
  MPN02: [
    409,
    "NOTATION_ETAT",
    "Opération impossible dans l'état actuel de la notation (version en revue, publiée ou remplacée).",
  ],
  MPN03: [409, "TRANSITION_REFUSEE", "Cette étape de revue n'est pas possible maintenant."],
  MPN04: [
    403,
    "SEPARATION_DES_TACHES",
    "Seul un expert métier publie la notation ou valide la grille, et jamais son propre travail (calcul, ajustement, soumission, rédaction).",
  ],
  MPN05: [
    409,
    "GRILLE_FIGEE",
    "Cette version de grille est validée : elle est figée, créez une nouvelle version.",
  ],
};

interface AnomalieMoteur {
  readonly code: string;
  readonly chemin: string;
  readonly message: string;
}

/** Anomalies détaillées → ZodError (400 REQUETE_INVALIDE avec détails par chemin). */
function erreurDetaillee(code: string, message: string, details: readonly AnomalieMoteur[]) {
  const issues: ZodIssue[] = [
    { code: "custom", path: [], message: `${code} : ${message}` },
    ...details.slice(0, 200).map((d): ZodIssue => ({
      code: "custom",
      path: [d.chemin],
      message: `${d.code} : ${d.message}`,
    })),
  ];
  return new ZodError(issues);
}

export function traduireErreurQuestionnaires(error: unknown): unknown {
  if (error instanceof ErreurQuestionnaire) {
    if (error.code === "DEJA_SOUMISE") {
      return new AppError(409, "QUESTIONNAIRE_DEJA_SOUMIS", error.message);
    }
    if (error.details.length > 0) return erreurDetaillee(error.code, error.message, error.details);
    return new AppError(400, error.code, error.message);
  }
  if (error instanceof ErreurNotation) {
    if (error.details.length > 0) return erreurDetaillee(error.code, error.message, error.details);
    return new AppError(400, error.code, error.message);
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  return error;
}
