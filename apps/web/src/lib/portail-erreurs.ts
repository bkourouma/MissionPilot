/** Espace client : messages d'erreur, invitation et règles du mot de passe. */
import { creerTraduire, MOT_DE_PASSE_MIN, type Langue } from "@missionpilot/shared";
import { CODE_TFA_A_CONFIGURER, ErreurApi } from "./api";
import { messageErreurLangue } from "./double-authentification";

// --- Erreurs -------------------------------------------------------------------------------

/** Conduite à tenir face à une erreur d'API sur une page du portail. */
export type IssueErreurPortail = "connexion" | "securite" | "afficher";

export function issueErreurPortail(statut: number, code: string): IssueErreurPortail {
  if (statut === 401) return "connexion";
  if (statut === 403 && code === CODE_TFA_A_CONFIGURER) return "securite";
  return "afficher";
}

/** Message affichable (français, sans jargon) pour une erreur d'appel du portail. */
export function messageErreurPortail(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (!(e instanceof ErreurApi)) return messageErreurLangue(e, langue);
  if (e.code === CODE_TFA_A_CONFIGURER)
    return t(
      "Votre cabinet demande d'activer la double authentification : rendez-vous dans « Sécurité » pour continuer.",
      "Your firm requires two-factor authentication to be turned on: go to \u201cSecurity\u201d to continue.",
    );
  if (e.statut === 403)
    return t(
      "Cet élément n'est pas accessible avec votre accès. Pour toute question, contactez votre interlocuteur au cabinet.",
      "This item is not accessible with your access. For any question, contact your contact person at the firm.",
    );
  if (e.statut === 404)
    return t(
      "Cet élément n'existe pas ou n'est plus partagé avec vous.",
      "This item does not exist or is no longer shared with you.",
    );
  if (e.code === "REQUETE_INVALIDE")
    return t(
      "La demande n'a pas pu être traitée. Revenez à la page précédente puis réessayez.",
      "The request could not be processed. Go back to the previous page, then try again.",
    );
  return e.message ? messageErreurLangue(e, langue) : messageErreurLangue(new Error(), langue);
}

/** Résultat d'un chargement affiché dans la page. */
export type ChargementPortail<T> =
  { ok: true; donnees: T } | { ok: false; statut: number; code: string; message: string };

// --- Invitation ----------------------------------------------------------------------------

/** Message affiché pour un refus de l'acceptation d'une invitation au portail. */
export function messageErreurInvitationPortail(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (!(e instanceof ErreurApi)) return messageErreurLangue(e, langue);
  if (e.code === "INVITATION_INVALIDE")
    return t(
      "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à votre interlocuteur au cabinet de vous envoyer une nouvelle invitation.",
      "This invitation link has expired or was already used. Ask your contact person at the firm to send you a new invitation.",
    );
  if (e.code === "CONFLIT")
    return t(
      "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec ce compte, ou contactez votre interlocuteur au cabinet.",
      "An account already exists with this email address. Sign in with that account, or contact your contact person at the firm.",
    );
  if (e.code === "REQUETE_INVALIDE")
    return t(
      "Le lien d'invitation est incomplet ou les informations saisies sont refusées. Vérifiez le lien reçu par e-mail.",
      "The invitation link is incomplete or the information entered was rejected. Check the link you received by email.",
    );
  if (e.code === "TROP_DE_TENTATIVES" || e.statut === 429)
    return t(
      "Trop de tentatives. Patientez quelques minutes avant de réessayer.",
      "Too many attempts. Wait a few minutes before trying again.",
    );
  return e.message ? messageErreurLangue(e, langue) : messageErreurLangue(new Error(), langue);
}

/**
 * Règles du mot de passe affichées sous les champs, mises à jour à la saisie (contrat de
 * l'API : 12 à 200 caractères ; le champ refuse lui-même la saisie au-delà de 200).
 */
export interface RegleMotDePasse {
  id: "longueur" | "confirmation";
  texte: string;
  respectee: boolean;
}

export function reglesMotDePasse(
  motDePasse: string,
  confirmation: string,
  langue: Langue = "fr",
): RegleMotDePasse[] {
  const t = creerTraduire(langue);
  const n = motDePasse.length;
  return [
    {
      id: "longueur",
      texte: t(
        `Au moins ${MOT_DE_PASSE_MIN} caractères (${n} saisi${n > 1 ? "s" : ""})`,
        `At least ${MOT_DE_PASSE_MIN} characters (${n} entered)`,
      ),
      respectee: n >= MOT_DE_PASSE_MIN && n <= 200,
    },
    {
      id: "confirmation",
      texte: t("Les deux mots de passe sont identiques", "Both passwords are identical"),
      respectee: confirmation !== "" && confirmation === motDePasse,
    },
  ];
}
