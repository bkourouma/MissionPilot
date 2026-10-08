import { ErreurAppelsOffres } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs des appels d'offres en erreurs HTTP (jamais de 500 pour une règle
 * métier) : SQLSTATE MPA… des déclencheurs (migrations 0360 à 0362), contraintes CHECK (23514),
 * unicité (23505), référence (23503) et invariants du moteur (`ErreurAppelsOffres`).
 */

const SQL: Record<string, [number, string, string]> = {
  MPA01: [
    409,
    "AO_HISTORIQUE_IMMUABLE",
    "Cet élément de l'appel d'offres est figé : l'historique est en ajout seul.",
  ],
  MPA02: [409, "AO_TRANSITION_REFUSEE", "Ce changement de statut n'est pas admis."],
  MPA03: [
    409,
    "AO_DECISION_REQUISE",
    "Ce passage exige la décision go/no-go d'un associé sur la dernière évaluation.",
  ],
  MPA04: [
    409,
    "AO_MATRICE_NON_CONFORME",
    "Dépôt refusé : toutes les exigences obligatoires doivent être conformes ou sans objet.",
  ],
  MPA05: [409, "AO_EXTRACTION_TRANCHEE", "Cette extraction est déjà validée ou rejetée."],
  MPA06: [
    409,
    "AO_REPONSE_FIGEE",
    "La réponse n'est plus en préparation : matrice et rétro-planning sont figés.",
  ],
  MPA07: [
    409,
    "CHIFFRES_A_ACQUITTER",
    "L'extraction cite des nombres non vérifiés : relisez-les puis acquittez-les pour valider.",
  ],
};

const UNICITES: Record<string, [string, string]> = {
  appels_offres_reference_uniq: [
    "AO_REFERENCE_EXISTANTE",
    "Un appel d'offres porte déjà cette référence.",
  ],
  ao_retroplanning_etapes_cabinet_id_ao_id_code_key: [
    "AO_RETROPLANNING_EXISTANT",
    "Le rétro-planning de cet appel d'offres existe déjà.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurAppelsOffres(error: unknown): unknown {
  if (error instanceof ErreurAppelsOffres) {
    return new AppError(error.code === "DATE_LIMITE_PASSEE" ? 409 : 400, error.code, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour l'appel d'offres.");
  }
  if (code === "23505") {
    const unicite = UNICITES[champ(error, "constraint")];
    if (unicite) return new AppError(409, unicite[0], unicite[1]);
    return new AppError(409, "CONFLIT", "Une autre modification vient d'être enregistrée.");
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
