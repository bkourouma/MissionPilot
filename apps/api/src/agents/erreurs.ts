import { ErreurAutonomie, ErreurContribution } from "@missionpilot/engines";
import { AppError, requeteInvalide } from "../errors.js";

/*
 * Erreurs du domaine des agents IA. Les SQLSTATE `MPG…` (migrations 0260-0264)
 * et les erreurs des moteurs purs (autonomie, contribution) deviennent des
 * erreurs métier, jamais une 500 :
 * - MPG01 historique en ajout seul → 409 HISTORIQUE_AGENTS_FIGE ;
 * - MPG02 au-delà du plafond du standard ou agent inconnu → 409 PLAFOND_AGENT ;
 * - MPG03 changement de niveau refusé par la base → 409 AUTONOMIE_REFUSEE ;
 * - MPG04 activation sans non-régression → 409 NON_REGRESSION_REQUISE ;
 * - MPG05 incohérence (exécution, décision, contribution, jeu) → 409 AGENTS_INCOHERENCE ;
 * - MPG06 validation d'un contenu issu d'une sortie d'agent non conforme (0266)
 *   → 409 SORTIE_AGENT_NON_CONFORME ;
 * - MPG07 classe de risque d'une brique refusée (plancher de la méthode, R0 hors
 *   associé ; 0267) → 409 CLASSE_RISQUE_REFUSEE ;
 * - MPG08 action réservée (levée d'une restriction d'associé, décision sur une
 *   exécution ; 0267) → 403 ACTION_RESERVEE ;
 * - MPG09 demande de rejeu réel d'une évaluation incohérente (état, jeu, prompt, évaluation
 *   « openrouter » sans demande ni appel inscrit ; 0270) → 409 EVALUATION_INCOHERENTE.
 *
 * Rejeu réel (agents/evaluations-openrouter.ts) : 409 EVALUATION_EN_COURS (un seul rejeu en file
 * ou en cours par cabinet), 409 EVALUATION_DEJA_REUSSIE, 429 TROP_DE_REJEUX (quota sur 24 h),
 * 409 PLAFOND_EVALUATION_ESTIME (estimation au-dessus du plafond par évaluation).
 */

const erreur = (statut: number, code: string, message: string) =>
  new AppError(statut, code, message);

export const agentInactif = () =>
  erreur(409, "AGENT_INACTIF", "Cet agent est désactivé pour le cabinet.");
export const plafondAgent = () =>
  erreur(409, "PLAFOND_AGENT", "Niveau au-delà de celui que le standard accorde à cet agent.");
export const briqueExiste = () =>
  erreur(409, "BRIQUE_EXISTE", "Cette brique est déjà confiée à un agent.");
export const autonomieN0 = () =>
  erreur(409, "AUTONOMIE_N0", "Niveau d'autonomie N0 : aucune IA sur cette brique.");
export const promotionNonEligible = (raisons: readonly string[]) =>
  erreur(
    409,
    "PROMOTION_NON_ELIGIBLE",
    `Promotion refusée : critères non remplis (${raisons.join(", ")}).`,
  );
export const promotionParPalier = () =>
  erreur(409, "PROMOTION_PAR_PALIER", "Une hausse d'autonomie se fait d'un niveau à la fois.");
export const plafondBrique = () =>
  erreur(409, "PLAFOND_BRIQUE", "Niveau au-delà du plafond de la brique ou de l'agent.");
export const niveauInchange = () =>
  erreur(409, "NIVEAU_INCHANGE", "La brique est déjà à ce niveau.");
export const coupeCircuitInchange = () =>
  erreur(409, "COUPE_CIRCUIT_INCHANGE", "Le coupe-circuit est déjà dans cet état.");
export const plafondMissionAtteint = () =>
  erreur(
    409,
    "PLAFOND_MISSION_ATTEINT",
    "Plafond de coût IA de la mission atteint : exécution refusée (le mode dégradé reste possible).",
  );
export const decisionExiste = () =>
  erreur(409, "DECISION_EXISTE", "Une décision est déjà enregistrée pour cette exécution.");
export const contenuNonValide = () =>
  erreur(
    409,
    "CONTENU_NON_VALIDE",
    "Le contenu doit d'abord être validé par le circuit humain (génération IA).",
  );
export const texteConserveAbsent = () =>
  erreur(
    409,
    "TEXTE_PURGE",
    "Le texte a été anonymisé (durée de conservation) : mesure impossible.",
  );
export const sortieNonConforme = () =>
  erreur(409, "SORTIE_AGENT_NON_CONFORME", "Sortie non conforme au schéma de l'agent : à rejeter.");
export const contributionExiste = () =>
  erreur(409, "CONTRIBUTION_EXISTE", "La contribution de l'IA à ce livrable est déjà mesurée.");
export const jeuEssaiAbsent = () =>
  erreur(409, "JEU_ESSAI_ABSENT", "Aucun jeu d'essai pour ce prompt : créez-en un d'abord.");
export const nonRegressionRequise = (
  message = "Activation refusée : aucune évaluation de non-régression réussie pour cette version ou ce modèle.",
) => erreur(409, "NON_REGRESSION_REQUISE", message);
export const jeuEssaiRequis = () =>
  erreur(
    409,
    "JEU_ESSAI_REQUIS",
    "Ce prompt n'a pas de jeu d'essai : un agent n'exécute qu'un prompt sous non-régression.",
  );
export const jeuEssaiAffaibli = (manquants: readonly string[]) =>
  new AppError(
    409,
    "JEU_ESSAI_AFFAIBLI",
    "La nouvelle version du jeu retire des cas ou laisse un cas sans critère : réservé à un associé.",
    { manquants },
  );
export const classeSousPlancher = (plancher: string) =>
  erreur(
    409,
    "CLASSE_RISQUE_SOUS_PLANCHER",
    `Classe de risque inférieure au plancher de la méthode pour cette brique (${plancher}).`,
  );
export const classeRisqueRefusee = () =>
  erreur(409, "CLASSE_RISQUE_REFUSEE", "Classe de risque refusée pour cette brique.");
export const iaNonConfiguree = () =>
  erreur(
    409,
    "IA_NON_CONFIGUREE",
    "Aucune clé API d'IA n'est disponible (cabinet ou plateforme) : le rejeu réel est impossible.",
  );
export const iaDesactivee = () =>
  erreur(
    409,
    "IA_DESACTIVEE",
    "L'IA est désactivée pour le cabinet : le rejeu réel est impossible.",
  );
export const evaluationEnCours = () =>
  erreur(
    409,
    "EVALUATION_EN_COURS",
    "Un rejeu réel est déjà en file ou en cours pour le cabinet : attendez sa fin.",
  );
export const evaluationDejaReussie = () =>
  erreur(
    409,
    "EVALUATION_DEJA_REUSSIE",
    "Cette version du prompt a déjà réussi le rejeu réel de ce jeu d'essai avec ce modèle : rien à rejouer.",
  );
export const tropDeRejeux = () =>
  erreur(
    429,
    "TROP_DE_REJEUX",
    "Trop de rejeux réels demandés sur les dernières 24 heures pour ce cabinet : réessayez plus tard.",
  );
export const plafondEvaluationEstime = () =>
  erreur(
    409,
    "PLAFOND_EVALUATION_ESTIME",
    "Le coût estimé du rejeu dépasse le plafond par évaluation : réduisez le jeu d'essai ou choisissez un modèle moins cher.",
  );
export const plafondEvaluationAtteint = () =>
  erreur(
    409,
    "PLAFOND_IA_ATTEINT",
    "Plafond mensuel de coût IA atteint : le rejeu réel de l'évaluation est refusé.",
  );
export const actionReservee = (message = "Action réservée à un associé.") =>
  erreur(403, "ACTION_RESERVEE", message);
const PAR_SQLSTATE: Record<string, () => AppError> = {
  MPG01: () => erreur(409, "HISTORIQUE_AGENTS_FIGE", "Historique des agents en ajout seul."),
  MPG02: plafondAgent,
  MPG03: () => erreur(409, "AUTONOMIE_REFUSEE", "Changement de niveau d'autonomie refusé."),
  MPG04: () => nonRegressionRequise(),
  MPG05: () =>
    erreur(409, "AGENTS_INCOHERENCE", "Opération incohérente avec l'exécution ou le jeu d'essai."),
  MPG06: sortieNonConforme,
  MPG07: classeRisqueRefusee,
  MPG08: () => actionReservee(),
  MPG09: () =>
    erreur(409, "EVALUATION_INCOHERENTE", "Demande d'évaluation incohérente avec son état."),
};

function codePg(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Erreur traduite (SQLSTATE MPG…, moteurs) ou l'erreur d'origine. */
export function traduireErreurAgents(error: unknown): unknown {
  const code = codePg(error);
  if (code && PAR_SQLSTATE[code]) return PAR_SQLSTATE[code]();
  if (error instanceof ErreurAutonomie || error instanceof ErreurContribution) {
    return requeteInvalide(error.message);
  }
  return error;
}

/** Exécute une action et traduit ses erreurs du domaine. */
export async function avecErreursAgents<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw traduireErreurAgents(error);
  }
}
