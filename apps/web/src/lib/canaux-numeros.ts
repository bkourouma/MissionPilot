/** Sous-module de `canaux.ts` : numéros, codes de vérification, consentements, messages d'erreur. */
import {
  MENTION_COURANTE,
  MENTIONS_CONSENTEMENT,
  creerTraduire,
  type CanalMessagerie,
  type DestinataireCanalApi,
  type Langue,
  type VersionMentionConsentement,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { messageReconfirmation } from "./double-authentification";
import type { Resultat } from "./saisie";
import { type DroitsCanaux } from "./canaux-comptes";

// --- Numéros, codes, consentements -----------------------------------------------------------

/** Numéro de test attendu par le simulateur (aucune donnée réelle de personne n'entre). */
export const EXEMPLE_NUMERO_TEST = "+2250000000012";
export const AIDE_NUMERO_SIMULE = `Numéro de test seulement (par exemple ${EXEMPLE_NUMERO_TEST}) : aucun numéro réel n'est accepté en mode simulé. Il n'est jamais réaffiché en entier.`;

/** Aide sous le champ du numéro, dans la langue demandée. */
export function aideNumeroSimule(langue: Langue = "fr"): string {
  if (langue === "en")
    return `Test number only (for example ${EXEMPLE_NUMERO_TEST}): no real number is accepted in simulated mode. It is never shown in full again.`;
  return AIDE_NUMERO_SIMULE;
}

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/;

export function validerNumeroSaisi(
  saisie: string,
  langue: Langue = "fr",
): Resultat<{ numero: string }, "numero"> {
  const t = creerTraduire(langue);
  const numero = saisie.trim();
  if (numero === "")
    return {
      ok: false,
      erreurs: { numero: t("Saisissez le numéro de téléphone.", "Enter the phone number.") },
    };
  if (numero.length < 5 || numero.length > 40 || CONTROLES.test(numero)) {
    return {
      ok: false,
      erreurs: {
        numero: t(
          "Numéro invalide : saisissez-le avec l'indicatif (ex. +225…).",
          "Invalid number: enter it with the country code (e.g. +225…).",
        ),
      },
    };
  }
  return { ok: true, charge: { numero } };
}

/** Code de vérification : six chiffres (espaces tolérés). */
export function validerCodeVerification(
  saisie: string,
  langue: Langue = "fr",
): Resultat<{ code: string }, "code"> {
  const t = creerTraduire(langue);
  const code = saisie.replace(/\s/g, "");
  if (code === "")
    return {
      ok: false,
      erreurs: { code: t("Saisissez le code reçu.", "Enter the code you received.") },
    };
  if (!/^\d{6}$/.test(code)) {
    return {
      ok: false,
      erreurs: {
        code: t("Le code comporte exactement 6 chiffres.", "The code has exactly 6 digits."),
      },
    };
  }
  return { ok: true, charge: { code } };
}

/** Référence de la preuve d'un consentement recueilli hors ligne : 10 à 500 caractères. */
export function validerReferencePreuve(
  saisie: string,
  langue: Langue = "fr",
): Resultat<{ statut: "accorde"; reference_preuve: string }, "reference_preuve"> {
  const t = creerTraduire(langue);
  const reference = saisie.trim();
  if (reference.length < 10) {
    return {
      ok: false,
      erreurs: {
        reference_preuve: t(
          "Décrivez la preuve du consentement en 10 caractères au moins (ex. formulaire signé le 12/03/2027, dossier n° 24).",
          "Describe the proof of consent in at least 10 characters (e.g. form signed on 12/03/2027, file no. 24).",
        ),
      },
    };
  }
  if (reference.length > 500) {
    return {
      ok: false,
      erreurs: {
        reference_preuve: t(
          "La référence ne doit pas dépasser 500 caractères.",
          "The reference must not exceed 500 characters.",
        ),
      },
    };
  }
  return { ok: true, charge: { statut: "accorde", reference_preuve: reference } };
}

/** Texte intégral de la mention en vigueur pour un canal (la version est celle envoyée au serveur). */
export function mentionPourCanal(
  canal: CanalMessagerie,
  langue: Langue = "fr",
): {
  version: VersionMentionConsentement;
  texte: string;
} {
  const version = MENTION_COURANTE[canal];
  if (langue === "en") {
    // Traduction d'affichage seulement : la version envoyée au serveur reste celle du texte français.
    const texte =
      canal === "whatsapp"
        ? "I agree to receive from my consulting firm, on this number, reminders and summaries containing no confidential data. I can unsubscribe at any time by replying STOP or from my space."
        : "I agree to receive from my consulting firm, by SMS on this number, reminders and summaries containing no confidential data. I can unsubscribe at any time by replying STOP or from my space.";
    return { version, texte };
  }
  return { version, texte: MENTIONS_CONSENTEMENT[version].texte };
}

/** Ce que le cabinet peut faire d'un destinataire (la source de vérité reste l'API). */
export interface ActionsDestinataire {
  enregistrerNumero: boolean;
  saisirCode: boolean;
  enregistrerConsentement: boolean;
  /** Pourquoi le cabinet ne peut pas redonner l'accord (STOP), sinon `null`. */
  motifConsentementImpossible: string | null;
  retirer: boolean;
}

export function actionsDestinataire(
  d: Pick<
    DestinataireCanalApi,
    "numero_masque" | "verifie" | "consentement" | "consentement_source"
  >,
  droits: Pick<DroitsCanaux, "gerer">,
  langue: Langue = "fr",
): ActionsDestinataire {
  const t = creerTraduire(langue);
  const aUnNumero = d.numero_masque !== null;
  const apresStop = d.consentement === "retire" && d.consentement_source === "message_stop";
  let motif: string | null = null;
  if (aUnNumero && d.verifie && apresStop) {
    motif = t(
      "Cette personne a répondu STOP : seule elle peut redonner son accord, depuis son espace du portail.",
      "This person replied STOP: only they can grant consent again, from their portal space.",
    );
  } else if (aUnNumero && !d.verifie) {
    motif = t(
      "Le numéro doit d'abord être vérifié par le code reçu.",
      "The number must first be verified with the code received.",
    );
  }
  return {
    enregistrerNumero: droits.gerer,
    saisirCode: droits.gerer && aUnNumero && !d.verifie,
    enregistrerConsentement:
      droits.gerer && aUnNumero && d.verifie && d.consentement !== "accorde" && !apresStop,
    motifConsentementImpossible: d.consentement === "accorde" ? null : motif,
    retirer: droits.gerer && d.consentement === "accorde",
  };
}

export function libelleNumero(
  d: Pick<DestinataireCanalApi, "numero_masque" | "verifie">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (d.numero_masque === null) return t("Aucun numéro", "No number");
  return d.verifie
    ? `${d.numero_masque} ${t("(vérifié)", "(verified)")}`
    : `${d.numero_masque} ${t("(à vérifier)", "(to verify)")}`;
}

/** Message affichable pour un refus de l'API sur les numéros, codes, consentements et comptes. */
export function messageErreurCanaux(
  e: unknown,
  facteur: "totp" | "secours" = "totp",
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "NUMERO_INVALIDE":
        return t(
          "Numéro invalide : saisissez-le avec l'indicatif du pays (ex. +225…).",
          "Invalid number: enter it with the country code (e.g. +225…).",
        );
      case "NUMERO_REEL_REFUSE_EN_SIMULE":
        return t(
          `Les canaux sont simulés : seuls les numéros de test sont acceptés (par exemple ${EXEMPLE_NUMERO_TEST}). Aucune donnée réelle de personne n'entre.`,
          `Channels are simulated: only test numbers are accepted (for example ${EXEMPLE_NUMERO_TEST}). No real personal data is entered.`,
        );
      case "CODE_INVALIDE":
        return t(
          "Code incorrect. Vérifiez-le ou demandez-en un nouveau en enregistrant à nouveau le numéro.",
          "Incorrect code. Check it or request a new one by saving the number again.",
        );
      case "CODE_EXPIRE":
        return t(
          "Ce code a expiré (10 minutes). Enregistrez à nouveau le numéro pour en recevoir un nouveau.",
          "This code has expired (10 minutes). Save the number again to receive a new one.",
        );
      case "MENTION_PERIMEE":
        return t(
          "La mention de consentement a changé. Rechargez la page pour lire la version en vigueur.",
          "The consent notice has changed. Reload the page to read the current version.",
        );
      case "CANAL_NON_ACTIF":
        return t(
          "Ce canal n'est pas activé par le cabinet : rien ne sera envoyé.",
          "This channel is not enabled by the firm: nothing will be sent.",
        );
      case "CONSENTEMENT_REQUIS":
        return t(
          "Un consentement est requis avant cette action.",
          "Consent is required before this action.",
        );
      case "TROP_DE_TENTATIVES":
        return t(
          "Trop de tentatives. Patientez avant de réessayer.",
          "Too many attempts. Wait before trying again.",
        );
      case "TROP_DE_REQUETES":
        return t(
          "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.",
          "Too many requests in a short time. Wait a moment before trying again.",
        );
      default:
        break;
    }
    const reconfirmation = messageReconfirmation(e, facteur, langue);
    if (reconfirmation) return reconfirmation;
  }
  return messageErreur(e);
}
