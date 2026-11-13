/** Logique pure de la connexion à la console de plateforme. Testée dans `connexion-logique.test.ts`. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
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

export function validerConnexionPlateforme(
  saisie: {
    email: string;
    motDePasse: string;
  },
  langue: Langue = "fr",
): ErreursConnexionPlateforme {
  const t = creerTraduire(langue);
  const erreurs: ErreursConnexionPlateforme = {};
  const email = saisie.email.trim();
  if (email === "")
    erreurs.email = t("Saisissez votre adresse e-mail.", "Enter your email address.");
  else if (email.length > EMAIL_MAX || !FORMAT_EMAIL.test(email))
    erreurs.email = t(
      "Adresse e-mail invalide. Exemple : prenom.nom@exemple.com",
      "Invalid email address. Example: first.last@example.com",
    );
  if (saisie.motDePasse === "")
    erreurs.motDePasse = t("Saisissez votre mot de passe.", "Enter your password.");
  else if (saisie.motDePasse.length > MOT_DE_PASSE_MAX)
    erreurs.motDePasse = t(
      `Maximum ${MOT_DE_PASSE_MAX} caractères.`,
      `Maximum ${MOT_DE_PASSE_MAX} characters.`,
    );
  return erreurs;
}

/** Message affiché à l'échec de la connexion : tout 401 est « identifiants incorrects ». */
export function messageConnexion(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi && e.statut === 401)
    return creerTraduire(langue)(MESSAGE_IDENTIFIANTS_INVALIDES, "Incorrect email or password.");
  return messageErreurPlateforme(e, langue);
}
