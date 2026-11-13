/** Logique pure de l'acceptation d'invitation, testée dans `invitation.test.ts`. */
import { creerTraduire, MOT_DE_PASSE_MIN, type Langue } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { messageErreurLangue } from "./double-authentification";

export { MOT_DE_PASSE_MIN };

/**
 * Jeton lu dans le fragment d'URL (`#jeton=…`). Le fragment n'est jamais envoyé au serveur
 * web : le jeton ne transite que dans le corps de la requête d'acceptation.
 */
export function lireJetonFragment(fragment: string): string | null {
  const brut = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const jeton = new URLSearchParams(brut).get("jeton")?.trim() ?? "";
  if (jeton.length < 20 || jeton.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(jeton)) return null;
  return jeton;
}

export interface SaisieInvitation {
  nom: string;
  motDePasse: string;
  confirmation: string;
}

export type ErreursInvitation = Partial<Record<keyof SaisieInvitation, string>>;

export function validerInvitation(s: SaisieInvitation, langue: Langue = "fr"): ErreursInvitation {
  const t = creerTraduire(langue);
  const erreurs: ErreursInvitation = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = t("Saisissez votre nom complet.", "Enter your full name.");
  else if (nom.length > 120)
    erreurs.nom = t(
      "Le nom ne doit pas dépasser 120 caractères.",
      "The name must not exceed 120 characters.",
    );

  if (s.motDePasse === "")
    erreurs.motDePasse = t("Choisissez un mot de passe.", "Choose a password.");
  else if (s.motDePasse.length < MOT_DE_PASSE_MIN)
    erreurs.motDePasse = t(
      `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères (actuellement ${s.motDePasse.length}).`,
      `The password must contain at least ${MOT_DE_PASSE_MIN} characters (currently ${s.motDePasse.length}).`,
    );
  else if (s.motDePasse.length > 200)
    erreurs.motDePasse = t(
      "Le mot de passe ne doit pas dépasser 200 caractères.",
      "The password must not exceed 200 characters.",
    );

  if (!erreurs.motDePasse && s.confirmation !== s.motDePasse)
    erreurs.confirmation = t(
      "Les deux mots de passe ne sont pas identiques.",
      "The two passwords do not match.",
    );
  return erreurs;
}

export function chargeInvitation(jeton: string, s: SaisieInvitation) {
  return { jeton, nom: s.nom.trim(), mot_de_passe: s.motDePasse };
}

/** Message affiché pour un refus de l'API, avec la conduite à tenir. */
export function messageErreurInvitation(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (!(e instanceof ErreurApi)) return messageErreurLangue(e, langue);
  if (e.code === "INVITATION_INVALIDE")
    return t(
      "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à un associé de votre cabinet de vous renvoyer une invitation.",
      "This invitation link has expired or was already used. Ask a partner of your firm to send you a new invitation.",
    );
  if (e.code === "CONFLIT")
    return t(
      "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec ce compte, ou utilisez la récupération de mot de passe auprès d'un associé.",
      "An account already exists with this email address. Sign in with that account, or ask a partner to help you recover your password.",
    );
  if (e.code === "REQUETE_INVALIDE")
    return t(
      "Le lien d'invitation est incomplet ou les informations saisies sont refusées. Vérifiez le lien reçu par e-mail.",
      "The invitation link is incomplete or the information entered was rejected. Check the link you received by email.",
    );
  return messageErreurLangue(e, langue);
}
