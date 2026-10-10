import { ErreurCv, ErreurOffreFinanciere } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs des banques et offres d'appels d'offres (lot AO-B) en erreurs HTTP,
 * jamais en 500 pour une règle métier : SQLSTATE MPW… des déclencheurs (0380 à 0383),
 * contraintes CHECK (23514), unicité (23505), référence (23503) et invariants des moteurs
 * (`ErreurCv`, `ErreurOffreFinanciere`).
 */

const VERSION_CONCURRENTE: [number, string, string] = [
  409,
  "VERSION_CONCURRENTE",
  "Une autre version vient d'être enregistrée : rechargez puis recommencez.",
];

const SQL: Record<string, [number, string, string]> = {
  MPW01: [
    409,
    "HISTORIQUE_IMMUABLE",
    "Les banques et offres sont en ajout seul : créez une nouvelle version.",
  ],
  MPW02: VERSION_CONCURRENTE,
  MPW03: [
    409,
    "INCOHERENCE_BANQUE_AO",
    "Rattachement ou validation incohérent : la mission n'est pas celle du client, ou la version n'est plus la dernière.",
  ],
  MPW04: [
    409,
    "CHIFFRES_A_ACQUITTER",
    "Le brouillon IA cite des nombres non vérifiés : relisez-les puis acquittez-les pour valider.",
  ],
  MPW05: [
    403,
    "APPROBATION_REQUISE",
    "Le demandeur ou l'auteur d'une version d'une offre ne la valide pas lui-même.",
  ],
  MPW06: [409, "CV_ANONYME", "Ce CV est anonymisé (ou inconnu) : aucune autre opération."],
};

const UNICITES: Record<string, [number, string, string]> = {
  ao_cv_collaborateur_uniq: [409, "CV_EXISTANT", "Ce collaborateur a déjà un CV dans la banque."],
  ao_cv_gabarits_cabinet_uniq: [409, "GABARIT_EXISTANT", "Un gabarit du cabinet porte ce code."],
  ao_attestations_fichier_id_key: [409, "FICHIER_DEJA_RATTACHE", "Ce fichier est déjà rattaché."],
  ao_offre_technique_validations_version_id_key: [
    409,
    "VERSION_DEJA_VALIDEE",
    "Cette version est déjà validée.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurBanqueAo(error: unknown): unknown {
  if (error instanceof ErreurCv || error instanceof ErreurOffreFinanciere) {
    return new AppError(400, error.code, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour la banque.");
  }
  if (code === "23505") {
    const u = UNICITES[champ(error, "constraint")] ?? VERSION_CONCURRENTE;
    return new AppError(u[0], u[1], u[2]);
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
