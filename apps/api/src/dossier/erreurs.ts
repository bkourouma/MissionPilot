import { ErreurDossier } from "@missionpilot/engines";
import { AppError, requeteInvalide } from "../errors.js";

/** SQLSTATE des déclencheurs du dossier client (migrations 0220 à 0223, lettre O). */
const SQL_AJOUT_SEUL = "MPO01";
const SQL_REMPLACEMENT = "MPO02";
const SQL_DECISION = "MPO03";
const SQL_ETAT_FIGE = "MPO04";

const MESSAGES_UNICITE: Record<string, [string, string]> = {
  dossier_faits_decisions_fait_id_key: ["DEJA_DECIDE", "Ce fait a déjà reçu une décision."],
  dossier_etats_decisions_etat_id_key: [
    "DEJA_DECIDE",
    "Cet état financier a déjà reçu une décision.",
  ],
  dossier_faits_remplace_id_key: [
    "DEJA_REMPLACE",
    "Ce fait a déjà été remplacé : partir du plus récent.",
  ],
  dossier_etats_financiers_remplace_id_key: [
    "DEJA_REMPLACE",
    "Cet état financier a déjà été remplacé : réessayer.",
  ],
};

function champ(error: unknown, nom: "code" | "constraint"): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

/**
 * Traduit les erreurs du moteur et des déclencheurs du dossier en erreurs HTTP : structure
 * d'état financier refusée par le moteur → 400 avec son code ; ajout seul, remplacement
 * incohérent, décision impossible, état figé → 409 ; double décision ou double remplacement
 * (unicité) → 409 ; référence inconnue → 400. Le reste remonte au gestionnaire de l'application.
 */
export function traduireErreurDossier(error: unknown): unknown {
  if (error instanceof ErreurDossier) return new AppError(400, error.code, error.message);
  const code = champ(error, "code");
  switch (code) {
    case SQL_AJOUT_SEUL:
      return new AppError(
        409,
        "DOSSIER_AJOUT_SEUL",
        "Le dossier s'enrichit par nouveaux enregistrements.",
      );
    case SQL_REMPLACEMENT:
      return new AppError(
        409,
        "REMPLACEMENT_INVALIDE",
        "Remplacement impossible : il vise un enregistrement courant du même client, de même clé ou du même exercice.",
      );
    case SQL_DECISION:
      return new AppError(
        409,
        "DECISION_INVALIDE",
        "Décision impossible : l'enregistrement est remplacé, ou un fait extrait par l'IA doit être confirmé séparément.",
      );
    case SQL_ETAT_FIGE:
      return new AppError(
        409,
        "ACCEPTATION_REFUSEE",
        "Acceptation refusée : un état en écart ne s'accepte qu'avec un motif, jamais automatiquement.",
      );
    case "23505": {
      const [c, message] = MESSAGES_UNICITE[champ(error, "constraint")] ?? [
        "CONFLIT",
        "Enregistrement déjà existant.",
      ];
      return new AppError(409, c, message);
    }
    case "23503":
      return requeteInvalide("Référence inconnue.");
    default:
      return error;
  }
}

/** Exécute `action` et traduit ses erreurs (moteur, déclencheurs, contraintes). */
export async function avecErreursDossier<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw traduireErreurDossier(error);
  }
}
