/** Sous-module de `canaux.ts` : numéros, codes de vérification, consentements, messages d'erreur. */
import {
  MENTION_COURANTE,
  MENTIONS_CONSENTEMENT,
  type CanalMessagerie,
  type DestinataireCanalApi,
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

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/;

export function validerNumeroSaisi(saisie: string): Resultat<{ numero: string }, "numero"> {
  const numero = saisie.trim();
  if (numero === "") return { ok: false, erreurs: { numero: "Saisissez le numéro de téléphone." } };
  if (numero.length < 5 || numero.length > 40 || CONTROLES.test(numero)) {
    return {
      ok: false,
      erreurs: { numero: "Numéro invalide : saisissez-le avec l'indicatif (ex. +225…)." },
    };
  }
  return { ok: true, charge: { numero } };
}

/** Code de vérification : six chiffres (espaces tolérés). */
export function validerCodeVerification(saisie: string): Resultat<{ code: string }, "code"> {
  const code = saisie.replace(/\s/g, "");
  if (code === "") return { ok: false, erreurs: { code: "Saisissez le code reçu." } };
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, erreurs: { code: "Le code comporte exactement 6 chiffres." } };
  }
  return { ok: true, charge: { code } };
}

/** Référence de la preuve d'un consentement recueilli hors ligne : 10 à 500 caractères. */
export function validerReferencePreuve(
  saisie: string,
): Resultat<{ statut: "accorde"; reference_preuve: string }, "reference_preuve"> {
  const reference = saisie.trim();
  if (reference.length < 10) {
    return {
      ok: false,
      erreurs: {
        reference_preuve:
          "Décrivez la preuve du consentement en 10 caractères au moins (ex. formulaire signé le 12/03/2027, dossier n° 24).",
      },
    };
  }
  if (reference.length > 500) {
    return {
      ok: false,
      erreurs: { reference_preuve: "La référence ne doit pas dépasser 500 caractères." },
    };
  }
  return { ok: true, charge: { statut: "accorde", reference_preuve: reference } };
}

/** Texte intégral de la mention en vigueur pour un canal (la version est celle envoyée au serveur). */
export function mentionPourCanal(canal: CanalMessagerie): {
  version: VersionMentionConsentement;
  texte: string;
} {
  const version = MENTION_COURANTE[canal];
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
): ActionsDestinataire {
  const aUnNumero = d.numero_masque !== null;
  const apresStop = d.consentement === "retire" && d.consentement_source === "message_stop";
  let motif: string | null = null;
  if (aUnNumero && d.verifie && apresStop) {
    motif =
      "Cette personne a répondu STOP : seule elle peut redonner son accord, depuis son espace du portail.";
  } else if (aUnNumero && !d.verifie) {
    motif = "Le numéro doit d'abord être vérifié par le code reçu.";
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

export function libelleNumero(d: Pick<DestinataireCanalApi, "numero_masque" | "verifie">): string {
  if (d.numero_masque === null) return "Aucun numéro";
  return d.verifie ? `${d.numero_masque} (vérifié)` : `${d.numero_masque} (à vérifier)`;
}

/** Message affichable pour un refus de l'API sur les numéros, codes, consentements et comptes. */
export function messageErreurCanaux(e: unknown, facteur: "totp" | "secours" = "totp"): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "NUMERO_INVALIDE":
        return "Numéro invalide : saisissez-le avec l'indicatif du pays (ex. +225…).";
      case "NUMERO_REEL_REFUSE_EN_SIMULE":
        return `Les canaux sont simulés : seuls les numéros de test sont acceptés (par exemple ${EXEMPLE_NUMERO_TEST}). Aucune donnée réelle de personne n'entre.`;
      case "CODE_INVALIDE":
        return "Code incorrect. Vérifiez-le ou demandez-en un nouveau en enregistrant à nouveau le numéro.";
      case "CODE_EXPIRE":
        return "Ce code a expiré (10 minutes). Enregistrez à nouveau le numéro pour en recevoir un nouveau.";
      case "MENTION_PERIMEE":
        return "La mention de consentement a changé. Rechargez la page pour lire la version en vigueur.";
      case "CANAL_NON_ACTIF":
        return "Ce canal n'est pas activé par le cabinet : rien ne sera envoyé.";
      case "CONSENTEMENT_REQUIS":
        return "Un consentement est requis avant cette action.";
      case "TROP_DE_TENTATIVES":
        return "Trop de tentatives. Patientez avant de réessayer.";
      case "TROP_DE_REQUETES":
        return "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.";
      default:
        break;
    }
    const reconfirmation = messageReconfirmation(e, facteur);
    if (reconfirmation) return reconfirmation;
  }
  return messageErreur(e);
}
