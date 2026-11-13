/** États affichés de la saisie hors ligne et de la connexion (textes testés dans `etats.test.ts`). */

import type { Langue } from "@missionpilot/shared";

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

export const MESSAGE_SAISIE_EN: Record<EtatSaisie, string> = {
  a_jour: "Draft saved.",
  modifie: "Changes in progress…",
  enregistrement: "Saving the draft…",
  en_attente:
    "Waiting to be sent: you are offline. Your entry is kept on this device and will be sent as soon as the network returns.",
  session:
    "Waiting to be sent: your session has expired. Sign in again; your entry is kept on this device.",
  refuse: "Save refused: correct the flagged entry.",
  conflit:
    "Entry not applied: the timesheet changed in the meantime. Your entry is kept: choose what to do with it.",
};

/** Message annoncé pour un état de la saisie, dans la langue demandée. */
export const messageSaisie = (e: EtatSaisie, langue: Langue = "fr") =>
  (langue === "en" ? MESSAGE_SAISIE_EN : MESSAGE_SAISIE)[e];

/** Avertissement quand le navigateur ne permet de garder la saisie qu'en mémoire. */
export const MESSAGE_MEMOIRE =
  "Ce navigateur ne permet pas de garder la saisie sur l'appareil : ne fermez pas cet onglet avant le retour du réseau.";

export const MESSAGE_MEMOIRE_EN =
  "This browser cannot keep the entry on the device: do not close this tab before the network returns.";

export const messageMemoire = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_MEMOIRE_EN : MESSAGE_MEMOIRE;

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
export function messageReseau(
  enLigne: boolean,
  vientDeRevenir: boolean,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    if (!enLigne) {
      return "Offline. Pages already open remain available; your time entries are kept on this device and will be sent when the network returns.";
    }
    return vientDeRevenir ? "Connection restored." : "";
  }
  if (!enLigne) {
    return "Hors connexion. Les pages déjà ouvertes restent consultables ; vos saisies de temps sont gardées sur cet appareil et partiront au retour du réseau.";
  }
  return vientDeRevenir ? "Connexion rétablie." : "";
}

/** « 1 saisie en attente d'envoi », « 2 saisies en attente d'envoi ». */
export function libelleNombreEnAttente(n: number, langue: Langue = "fr"): string {
  if (langue === "en")
    return n === 1 ? `${n} entry waiting to be sent` : `${n} entries waiting to be sent`;
  return n <= 1 ? `${n} saisie en attente d'envoi` : `${n} saisies en attente d'envoi`;
}
