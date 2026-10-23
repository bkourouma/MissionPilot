/** Questionnaires du portail : refus de l'API (issues, messages, erreurs par question). */
import { CODE_TFA_A_CONFIGURER, ErreurApi, MESSAGE_INATTENDU } from "./api";

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
): string {
  const collectif = mode === "collectif";
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
      return e instanceof ErreurApi && e.message ? e.message : MESSAGE_INATTENDU;
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

export const MESSAGE_REFUS_SERVEUR = "Réponse refusée par le serveur : vérifiez-la.";

/**
 * Erreurs par question renvoyées par l'API (400 REQUETE_INVALIDE, `details.fieldErrors`
 * indexés par identifiant de question, messages « CODE : texte »). Seuls les identifiants de
 * la définition sont retenus ; le texte affiché est celui de ce module, en français.
 */
export function erreursQuestionsServeur(
  e: unknown,
  idsConnus: ReadonlySet<string>,
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
    erreurs[id] = MESSAGES_CODES[code] ?? MESSAGE_REFUS_SERVEUR;
  }
  return erreurs;
}
