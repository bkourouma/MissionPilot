/** Questionnaires du portail : refus de l'API (issues, messages, erreurs par question). */
import type { Langue } from "@missionpilot/shared";
import { CODE_TFA_A_CONFIGURER, ErreurApi, messageInattendu } from "./api";

// --- Refus de l'API ------------------------------------------------------------------------

/** Conduite à tenir face à un refus de l'API pendant la saisie ou l'envoi. */
export type IssueRefus =
  | "reseau"
  | "indisponible"
  | "session"
  | "securite"
  | "interdit"
  | "introuvable"
  | "verrouille"
  | "clos"
  | "echeance"
  | "invalide"
  | "autre";

export function issueRefus(e: unknown): IssueRefus {
  if (!(e instanceof ErreurApi)) return "autre";
  if (e.statut === 0) return "reseau";
  if (e.statut >= 500 || e.statut === 429) return "indisponible";
  if (e.statut === 401) return "session";
  if (e.statut === 403) return e.code === CODE_TFA_A_CONFIGURER ? "securite" : "interdit";
  if (e.statut === 404) return "introuvable";
  if (e.statut === 409) {
    if (e.code === "QUESTIONNAIRE_DEJA_SOUMIS" || e.code === "REPONSE_VERROUILLEE") {
      return "verrouille";
    }
    if (e.code === "DATE_LIMITE_DEPASSEE") return "echeance";
    return "clos";
  }
  if (e.statut === 400) return "invalide";
  return "autre";
}

/** Une coupure, un délai ou une indisponibilité se retente ; un refus de l'API, non. */
export const estReessayable = (issue: IssueRefus) => issue === "reseau" || issue === "indisponible";

/** Délai avant une nouvelle tentative d'enregistrement : 2 s, 4 s, 8 s… plafonné à 30 s. */
export function delaiNouvelleTentative(tentatives: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, Math.min(tentatives, 10)));
}

/** L'issue fige-t-elle le questionnaire (lecture seule) ? */
export const issueBloquante = (issue: IssueRefus) =>
  issue === "verrouille" ||
  issue === "clos" ||
  issue === "echeance" ||
  issue === "introuvable" ||
  issue === "interdit";

/** Message affiché pour un refus, selon le moment (sauvegarde du brouillon ou envoi). */
export function messageRefus(
  issue: IssueRefus,
  mode: string,
  moment: "brouillon" | "envoi",
  e?: unknown,
  langue: Langue = "fr",
): string {
  const collectif = mode === "collectif";
  if (langue === "en") return messageRefusEn(issue, collectif, moment, e);
  switch (issue) {
    case "reseau":
      return moment === "brouillon"
        ? "Connexion perdue : vos réponses restent affichées dans cette page et seront enregistrées dès le retour du réseau. Ne fermez pas la page."
        : "La connexion a été interrompue : l'envoi n'a peut-être pas abouti. Vérifiez votre réseau puis réessayez.";
    case "indisponible":
      return moment === "brouillon"
        ? "Le service est momentanément indisponible : nouvelle tentative d'enregistrement dans quelques instants. Ne fermez pas la page."
        : "Le service est momentanément indisponible. Réessayez dans quelques instants.";
    case "session":
      return "Votre session a expiré : vos dernières réponses ne sont pas enregistrées. Reconnectez-vous dans un nouvel onglet, puis revenez sur cette page : vos réponses y sont toujours, choisissez « Enregistrer le brouillon ».";
    case "securite":
      return "Votre cabinet demande d'activer la double authentification : rendez-vous dans « Sécurité » pour continuer.";
    case "interdit":
      return "Votre accès ne permet pas de répondre à ce questionnaire. Pour toute question, contactez votre interlocuteur au cabinet.";
    case "introuvable":
      return "Ce questionnaire n'est plus accessible : il a pu être retiré par le cabinet.";
    case "verrouille":
      return collectif
        ? "La réponse de votre entreprise a déjà été envoyée : elle est verrouillée et ne peut plus être modifiée."
        : "Vos réponses ont déjà été envoyées : elles sont verrouillées et ne peuvent plus être modifiées.";
    case "clos":
      return "Le cabinet a clos ce questionnaire : il n'accepte plus de réponse.";
    case "echeance":
      return "La date limite de ce questionnaire est dépassée : il n'accepte plus de réponse. Contactez votre interlocuteur au cabinet pour demander une prolongation.";
    case "invalide":
      return moment === "brouillon"
        ? "Certaines réponses ont été refusées : corrigez les questions signalées pour les enregistrer."
        : "Le questionnaire ne peut pas être envoyé en l'état : vérifiez les questions signalées.";
    case "autre":
      return e instanceof ErreurApi && e.message ? e.message : messageInattendu();
  }
}

function messageRefusEn(
  issue: IssueRefus,
  collectif: boolean,
  moment: "brouillon" | "envoi",
  e?: unknown,
): string {
  switch (issue) {
    case "reseau":
      return moment === "brouillon"
        ? "Connection lost: your responses stay displayed on this page and will be saved as soon as the network returns. Do not close the page."
        : "The connection was interrupted: sending may not have succeeded. Check your network, then try again.";
    case "indisponible":
      return moment === "brouillon"
        ? "The service is temporarily unavailable: saving will be retried in a few moments. Do not close the page."
        : "The service is temporarily unavailable. Try again in a few moments.";
    case "session":
      return 'Your session has expired: your latest responses are not saved. Sign in again in a new tab, then come back to this page: your responses are still here, choose "Save draft".';
    case "securite":
      return 'Your firm requires two-factor authentication to be enabled: go to "Security" to continue.';
    case "interdit":
      return "Your access does not allow you to answer this questionnaire. For any question, contact your point of contact at the firm.";
    case "introuvable":
      return "This questionnaire is no longer accessible: it may have been removed by the firm.";
    case "verrouille":
      return collectif
        ? "Your company's response has already been sent: it is locked and can no longer be edited."
        : "Your responses have already been sent: they are locked and can no longer be edited.";
    case "clos":
      return "The firm has closed this questionnaire: it no longer accepts responses.";
    case "echeance":
      return "The due date of this questionnaire has passed: it no longer accepts responses. Contact your point of contact at the firm to request an extension.";
    case "invalide":
      return moment === "brouillon"
        ? "Some responses were rejected: correct the flagged questions to save them."
        : "The questionnaire cannot be sent as is: check the flagged questions.";
    case "autre":
      return e instanceof ErreurApi && e.message ? e.message : messageInattendu("en");
  }
}

/** Détails de validation renvoyés par l'API (`ZodError.flatten()`, chemins = questions). */
interface DetailsValidation {
  fieldErrors?: Record<string, unknown>;
}

const MESSAGES_CODES: Record<string, string> = {
  OBLIGATOIRE: "Cette question est obligatoire.",
  TYPE_INVALIDE: "Réponse d'un format inattendu : saisissez-la de nouveau.",
  HORS_ECHELLE: "Choisissez un niveau de l'échelle proposée.",
  OPTION_INCONNUE: "Ce choix n'est plus proposé : choisissez parmi les options affichées.",
  SELECTION_INSUFFISANTE: "Cochez davantage de choix.",
  SELECTION_EXCESSIVE: "Cochez moins de choix.",
  HORS_BORNES: "Valeur hors des limites indiquées.",
  NON_ENTIER: "Saisissez un nombre entier.",
  TROP_LONG: "Réponse trop longue : raccourcissez-la.",
  DATE_INVALIDE: "Saisissez une date valide.",
};

const MESSAGES_CODES_EN: Record<string, string> = {
  OBLIGATOIRE: "This question is required.",
  TYPE_INVALIDE: "Response in an unexpected format: enter it again.",
  HORS_ECHELLE: "Choose a level from the proposed scale.",
  OPTION_INCONNUE: "This choice is no longer offered: choose among the displayed options.",
  SELECTION_INSUFFISANTE: "Select more choices.",
  SELECTION_EXCESSIVE: "Select fewer choices.",
  HORS_BORNES: "Value outside the indicated limits.",
  NON_ENTIER: "Enter a whole number.",
  TROP_LONG: "Response too long: shorten it.",
  DATE_INVALIDE: "Enter a valid date.",
};

export const MESSAGE_REFUS_SERVEUR = "Réponse refusée par le serveur : vérifiez-la.";
export const MESSAGE_REFUS_SERVEUR_EN = "Response rejected by the server: check it.";

/**
 * Erreurs par question renvoyées par l'API (400 REQUETE_INVALIDE, `details.fieldErrors`
 * indexés par identifiant de question, messages « CODE : texte »). Seuls les identifiants de
 * la définition sont retenus ; le texte affiché est celui de ce module, en français.
 */
export function erreursQuestionsServeur(
  e: unknown,
  idsConnus: ReadonlySet<string>,
  langue: Langue = "fr",
): Record<string, string> {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return {};
  const details = e.details as DetailsValidation | undefined;
  const champs = details && typeof details === "object" ? details.fieldErrors : undefined;
  if (!champs || typeof champs !== "object") return {};
  const erreurs: Record<string, string> = {};
  for (const [id, messages] of Object.entries(champs)) {
    if (!idsConnus.has(id)) continue;
    const premier = Array.isArray(messages) ? messages[0] : undefined;
    const code = typeof premier === "string" ? (premier.split(" : ", 1)[0] ?? "") : "";
    erreurs[id] =
      langue === "en"
        ? (MESSAGES_CODES_EN[code] ?? MESSAGE_REFUS_SERVEUR_EN)
        : (MESSAGES_CODES[code] ?? MESSAGE_REFUS_SERVEUR);
  }
  return erreurs;
}
