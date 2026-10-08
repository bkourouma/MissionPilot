import { ErreurPreuves } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs du registre des preuves en erreurs HTTP (jamais de 500 pour une règle
 * métier) : SQLSTATE MPV… des déclencheurs (migrations 0240 à 0243), contraintes CHECK (23514),
 * unicité (23505), référence (23503) et invariants du moteur (`ErreurPreuves`).
 */

const SQL: Record<string, [number, string, string]> = {
  MPV01: [
    409,
    "PREUVE_HISTORIQUE_IMMUABLE",
    "Le registre des preuves est en ajout seul : corrigez par une nouvelle version.",
  ],
  MPV02: [400, "PREUVE_INCOHERENTE", "Référence incohérente avec la mission de la preuve."],
  MPV03: [
    409,
    "PREUVE_VERSION_CONCURRENTE",
    "Une autre correction vient d'être enregistrée : rechargez puis recommencez.",
  ],
  MPV04: [
    400,
    "AVIS_EXPERT_INVALIDE",
    "Un avis d'expert est signé par l'auteur de la version, expert métier ou associé.",
  ],
  MPV05: [
    409,
    "ARBITRAGE_INVALIDE",
    "Cette contradiction n'est plus à arbitrer : la preuve a changé ou n'est plus liée « contre ».",
  ],
  MPV06: [
    409,
    "CLASSE_RISQUE_ABAISSEE",
    "Seul un expert métier ou un associé abaisse la classe de risque d'une assertion.",
  ],
  MPV07: [
    409,
    "ARBITRAGE_PAR_AUTEUR",
    "L'auteur de l'assertion ou de la preuve contraire ne lève pas lui-même la contradiction.",
  ],
};

const UNICITES: Record<string, [string, string]> = {
  preuve_dimensions_cabinet_id_mission_id_code_key: [
    "DIMENSION_EXISTANTE",
    "Cette dimension existe déjà pour la mission.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurPreuves(error: unknown): unknown {
  if (error instanceof ErreurPreuves) return new AppError(400, error.code, error.message);
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23514") {
    return new AppError(
      400,
      "REQUETE_INVALIDE",
      "Valeurs incohérentes pour le registre des preuves.",
    );
  }
  if (code === "23505") {
    const unicite = UNICITES[champ(error, "constraint")];
    if (unicite) return new AppError(409, unicite[0], unicite[1]);
    return new AppError(
      409,
      "PREUVE_VERSION_CONCURRENTE",
      "Une autre correction vient d'être enregistrée : rechargez puis recommencez.",
    );
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
