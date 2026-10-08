import { ErreurAutomatisation } from "@missionpilot/engines";
import { AppError, requeteInvalide } from "../errors.js";

/*
 * Erreurs du moteur d'automatisation (AUT-01 à AUT-06, migrations 0300–0302). Les SQLSTATE
 * `MPU…` et les erreurs du moteur pur deviennent des erreurs métier, jamais une 500 :
 * - MPU01 historique en ajout seul → 409 HISTORIQUE_AUTOMATISATIONS_FIGE ;
 * - MPU02 levée d'un coupe-circuit hors associé → 403 ACTION_RESERVEE ;
 * - MPU03 annulation d'une action non annulable ou non réussie → 409 ANNULATION_IMPOSSIBLE ;
 * - MPU04 action vers le client hors R0 → 409 GARDE_AUTOMATISATION ;
 * - MPU05 incohérence (version, résultat) → 409 AUTOMATISATION_INCOHERENTE.
 */

const erreur = (statut: number, code: string, message: string, details?: AppError["details"]) =>
  new AppError(statut, code, message, details);

export const definitionInvalide = (erreurs: readonly unknown[]) =>
  erreur(400, "DEFINITION_INVALIDE", "Définition d'automatisation invalide pour cet événement.", {
    erreurs,
  });
export const automatisationStandardInconnue = () =>
  erreur(404, "INTROUVABLE", "Automatisation standard introuvable.");
export const automatisationStandardExiste = () =>
  erreur(409, "AUTOMATISATION_STANDARD_EXISTE", "Cette automatisation standard est déjà ajoutée.");
export const etatInchange = (message: string) => erreur(409, "ETAT_INCHANGE", message);
export const plafondAutomatisationsAtteint = (maximum: number) =>
  erreur(
    409,
    "PLAFOND_AUTOMATISATIONS_ATTEINT",
    `Au plus ${maximum} automatisations actives par cabinet : désactivez-en une avant d'en activer une autre.`,
  );
export const tropDeSimulations = (maximum: number, minutes: number) =>
  erreur(
    429,
    "TROP_DE_SIMULATIONS",
    `Au plus ${maximum} simulations par ${minutes} minutes : réessayez plus tard.`,
  );
export const coupeCircuitInchange = () =>
  erreur(409, "COUPE_CIRCUIT_INCHANGE", "Le coupe-circuit est déjà dans cet état.");
export const actionReservee = (message = "Action réservée à un associé.") =>
  erreur(403, "ACTION_RESERVEE", message);
export const annulationImpossible = (message: string) =>
  erreur(409, "ANNULATION_IMPOSSIBLE", message);
export const decisionExiste = () =>
  erreur(409, "DECISION_EXISTE", "Une décision est déjà enregistrée pour ce brouillon.");

const PAR_SQLSTATE: Record<string, () => AppError> = {
  MPU01: () =>
    erreur(409, "HISTORIQUE_AUTOMATISATIONS_FIGE", "Historique des automatisations en ajout seul."),
  MPU02: () => actionReservee("Seul un associé lève un coupe-circuit d'automatisation."),
  MPU03: () => annulationImpossible("Seule une action annulable et réussie s'annule."),
  MPU04: () =>
    erreur(409, "GARDE_AUTOMATISATION", "Action vers le client réservée à la classe R0."),
  MPU05: () =>
    erreur(409, "AUTOMATISATION_INCOHERENTE", "Opération incohérente avec l'automatisation."),
};

function codePg(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Erreur traduite (SQLSTATE MPU…, moteur) ou l'erreur d'origine. */
export function traduireErreurAutomatisation(error: unknown): unknown {
  const code = codePg(error);
  if (code && PAR_SQLSTATE[code]) return PAR_SQLSTATE[code]();
  if (error instanceof ErreurAutomatisation) return requeteInvalide(error.message);
  return error;
}

/** Exécute une opération et traduit ses erreurs du domaine. */
export async function avecErreursAutomatisation<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw traduireErreurAutomatisation(error);
  }
}
