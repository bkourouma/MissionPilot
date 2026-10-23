/** Espace client : messages d'erreur, invitation et règles du mot de passe. */
import { MOT_DE_PASSE_MIN } from "@missionpilot/shared";
import { CODE_TFA_A_CONFIGURER, ErreurApi, MESSAGE_INATTENDU } from "./api";

// --- Erreurs -------------------------------------------------------------------------------

/** Conduite à tenir face à une erreur d'API sur une page du portail. */
export type IssueErreurPortail = "connexion" | "securite" | "afficher";

export function issueErreurPortail(statut: number, code: string): IssueErreurPortail {
  if (statut === 401) return "connexion";
  if (statut === 403 && code === CODE_TFA_A_CONFIGURER) return "securite";
  return "afficher";
}

/** Message affichable (français, sans jargon) pour une erreur d'appel du portail. */
export function messageErreurPortail(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === CODE_TFA_A_CONFIGURER)
    return "Votre cabinet demande d'activer la double authentification : rendez-vous dans « Sécurité » pour continuer.";
  if (e.statut === 403)
    return "Cet élément n'est pas accessible avec votre accès. Pour toute question, contactez votre interlocuteur au cabinet.";
  if (e.statut === 404) return "Cet élément n'existe pas ou n'est plus partagé avec vous.";
  if (e.code === "REQUETE_INVALIDE")
    return "La demande n'a pas pu être traitée. Revenez à la page précédente puis réessayez.";
  return e.message || MESSAGE_INATTENDU;
}

/** Résultat d'un chargement affiché dans la page. */
export type ChargementPortail<T> =
  { ok: true; donnees: T } | { ok: false; statut: number; code: string; message: string };

// --- Invitation ----------------------------------------------------------------------------

/** Message affiché pour un refus de l'acceptation d'une invitation au portail. */
export function messageErreurInvitationPortail(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === "INVITATION_INVALIDE")
    return "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à votre interlocuteur au cabinet de vous envoyer une nouvelle invitation.";
  if (e.code === "CONFLIT")
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec ce compte, ou contactez votre interlocuteur au cabinet.";
  if (e.code === "REQUETE_INVALIDE")
    return "Le lien d'invitation est incomplet ou les informations saisies sont refusées. Vérifiez le lien reçu par e-mail.";
  if (e.code === "TROP_DE_TENTATIVES" || e.statut === 429)
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  return e.message || MESSAGE_INATTENDU;
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

export function reglesMotDePasse(motDePasse: string, confirmation: string): RegleMotDePasse[] {
  const n = motDePasse.length;
  return [
    {
      id: "longueur",
      texte: `Au moins ${MOT_DE_PASSE_MIN} caractères (${n} saisi${n > 1 ? "s" : ""})`,
      respectee: n >= MOT_DE_PASSE_MIN && n <= 200,
    },
    {
      id: "confirmation",
      texte: "Les deux mots de passe sont identiques",
      respectee: confirmation !== "" && confirmation === motDePasse,
    },
  ];
}
