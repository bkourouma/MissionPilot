/** Logique pure de l'acceptation d'invitation, testée dans `invitation.test.ts`. */
import { MOT_DE_PASSE_MIN } from "@missionpilot/shared";
import { ErreurApi, MESSAGE_INATTENDU } from "./api";

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

export function validerInvitation(s: SaisieInvitation): ErreursInvitation {
  const erreurs: ErreursInvitation = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez votre nom complet.";
  else if (nom.length > 120) erreurs.nom = "Le nom ne doit pas dépasser 120 caractères.";

  if (s.motDePasse === "") erreurs.motDePasse = "Choisissez un mot de passe.";
  else if (s.motDePasse.length < MOT_DE_PASSE_MIN)
    erreurs.motDePasse = `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères (actuellement ${s.motDePasse.length}).`;
  else if (s.motDePasse.length > 200)
    erreurs.motDePasse = "Le mot de passe ne doit pas dépasser 200 caractères.";

  if (!erreurs.motDePasse && s.confirmation !== s.motDePasse)
    erreurs.confirmation = "Les deux mots de passe ne sont pas identiques.";
  return erreurs;
}

export function chargeInvitation(jeton: string, s: SaisieInvitation) {
  return { jeton, nom: s.nom.trim(), mot_de_passe: s.motDePasse };
}

/** Message affiché pour un refus de l'API, avec la conduite à tenir. */
export function messageErreurInvitation(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === "INVITATION_INVALIDE")
    return "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à un associé de votre cabinet de vous renvoyer une invitation.";
  if (e.code === "CONFLIT")
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec ce compte, ou utilisez la récupération de mot de passe auprès d'un associé.";
  if (e.code === "REQUETE_INVALIDE")
    return "Le lien d'invitation est incomplet ou les informations saisies sont refusées. Vérifiez le lien reçu par e-mail.";
  return e.message;
}
