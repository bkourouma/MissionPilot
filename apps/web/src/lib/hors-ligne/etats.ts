/** États affichés de la saisie hors ligne et de la connexion (textes testés dans `etats.test.ts`). */

export type EtatSaisie =
  "a_jour" | "modifie" | "enregistrement" | "en_attente" | "session" | "refuse" | "conflit";

/** Message annoncé (role="status") pour chaque état de la saisie. */
export const MESSAGE_SAISIE: Record<EtatSaisie, string> = {
  a_jour: "Brouillon enregistré.",
  modifie: "Modifications en cours…",
  enregistrement: "Enregistrement du brouillon…",
  en_attente:
    "En attente d'envoi : vous êtes hors connexion. Votre saisie est gardée sur cet appareil et partira dès le retour du réseau.",
  session:
    "En attente d'envoi : votre session a expiré. Reconnectez-vous ; votre saisie est gardée sur cet appareil.",
  refuse: "Enregistrement refusé : corrigez la saisie signalée.",
  conflit:
    "Saisie non appliquée : la feuille a changé entre-temps. Votre saisie est gardée : choisissez quoi en faire.",
};

/** Avertissement quand le navigateur ne permet de garder la saisie qu'en mémoire. */
export const MESSAGE_MEMOIRE =
  "Ce navigateur ne permet pas de garder la saisie sur l'appareil : ne fermez pas cet onglet avant le retour du réseau.";

/** Classe de style existante (`temps.css`) associée à l'état. */
export function classeSaisie(e: EtatSaisie): string {
  if (e === "en_attente" || e === "session") return "hors_ligne";
  if (e === "conflit") return "refuse";
  return e;
}

export function iconeSaisie(e: EtatSaisie): "nuage" | "attention" | "succes" {
  if (e === "en_attente" || e === "session") return "nuage";
  if (e === "refuse" || e === "conflit") return "attention";
  return "succes";
}

/** Texte de l'indicateur de connexion (vide quand tout va bien : rien à annoncer). */
export function messageReseau(enLigne: boolean, vientDeRevenir: boolean): string {
  if (!enLigne) {
    return "Hors connexion. Les pages déjà ouvertes restent consultables ; vos saisies de temps sont gardées sur cet appareil et partiront au retour du réseau.";
  }
  return vientDeRevenir ? "Connexion rétablie." : "";
}

/** « 1 saisie en attente d'envoi », « 2 saisies en attente d'envoi ». */
export function libelleNombreEnAttente(n: number): string {
  return n <= 1 ? `${n} saisie en attente d'envoi` : `${n} saisies en attente d'envoi`;
}
