/** Logique pure de la connexion à la console de plateforme. Testée dans `connexion-logique.test.ts`. */
import { ErreurApi } from "../../../lib/api";
import {
  EMAIL_MAX,
  MESSAGE_IDENTIFIANTS_INVALIDES,
  messageErreurPlateforme,
  MOT_DE_PASSE_MAX,
} from "../../../lib/plateforme";

export interface ErreursConnexionPlateforme {
  email?: string;
  motDePasse?: string;
}

const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validerConnexionPlateforme(saisie: {
  email: string;
  motDePasse: string;
}): ErreursConnexionPlateforme {
  const erreurs: ErreursConnexionPlateforme = {};
  const email = saisie.email.trim();
  if (email === "") erreurs.email = "Saisissez votre adresse e-mail.";
  else if (email.length > EMAIL_MAX || !FORMAT_EMAIL.test(email))
    erreurs.email = "Adresse e-mail invalide. Exemple : prenom.nom@exemple.com";
  if (saisie.motDePasse === "") erreurs.motDePasse = "Saisissez votre mot de passe.";
  else if (saisie.motDePasse.length > MOT_DE_PASSE_MAX)
    erreurs.motDePasse = `Maximum ${MOT_DE_PASSE_MAX} caractères.`;
  return erreurs;
}

/** Message affiché à l'échec de la connexion : tout 401 est « identifiants incorrects ». */
export function messageConnexion(e: unknown): string {
  if (e instanceof ErreurApi && e.statut === 401) return MESSAGE_IDENTIFIANTS_INVALIDES;
  return messageErreurPlateforme(e);
}
