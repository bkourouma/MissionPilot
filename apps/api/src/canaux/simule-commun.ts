import { createHash } from "node:crypto";
import { estNumeroDeTest } from "@missionpilot/engines";
import { ErreurCanal, type ResultatEnvoi } from "./ports.js";

/*
 * Mécanique commune aux fournisseurs de messagerie SIMULÉS (WhatsApp, SMS ; SPEC-3c §4.1) :
 * numéros de test seuls, comportement selon les deux derniers chiffres, identifiant externe
 * déterministe, boîte en mémoire des 100 derniers messages. Aucune E/S réseau, aucune horloge
 * cachée.
 */

/** Taille de la boîte simulée (les 100 derniers messages). */
export const TAILLE_BOITE_SIMULEE = 100;

/** Message « envoyé » par un simulateur : lu par l'écran « Simulateur » et par les tests seulement. */
export interface MessageSimule {
  idExterne: string;
  compte: string;
  numero: string;
  gabarit: string;
  texte: string;
  instant: Date;
}

/** `prefixe` + 16 premiers hexadécimaux de SHA-256(idempotence) : même entrée, même identifiant. */
export function idExterneSimule(prefixe: "sim-wa-" | "sim-sms-", idempotence: string): string {
  return `${prefixe}${createHash("sha256").update(idempotence, "utf8").digest("hex").slice(0, 16)}`;
}

/** Aucun numéro réel n'entre : tout numéro hors de la plage de test est refusé par le simulateur. */
export function exigerNumeroDeTest(numero: string): void {
  if (!estNumeroDeTest(numero)) throw new ErreurCanal("NUMERO_REEL_REFUSE_EN_SIMULE");
}

const refus = (
  codeRefus: NonNullable<ResultatEnvoi["codeRefus"]>,
  reessayable: boolean,
): ResultatEnvoi => ({ statut: "refuse", idExterne: null, codeRefus, reessayable });

/**
 * Comportement d'un numéro de test selon ses deux derniers chiffres (jeux d'essai) ; `appel` est
 * le nombre d'appels déjà reçus pour cette idempotence (le numéro « 96 » échoue au premier).
 * Renvoie un refus, ou null si le message est accepté ; « 95 » lève une issue inconnue.
 */
export function refusSelonNumero(numero: string, appel: number): ResultatEnvoi | null {
  switch (numero.slice(-2)) {
    case "00":
      return refus("NUMERO_NON_JOIGNABLE", false);
    case "97":
      return refus("GABARIT_REFUSE", false);
    case "98":
      return refus("QUOTA_ATTEINT", false);
    case "99":
      return refus("INDISPONIBLE", true);
    case "96":
      return appel === 0 ? refus("INDISPONIBLE", true) : null;
    case "95":
      throw new ErreurCanal("DELAI_DEPASSE");
    default:
      return null;
  }
}

export { refus as refusDe };

/** Boîte bornée : un nouvel élément chasse le plus ancien au-delà de TAILLE_BOITE_SIMULEE. */
export function ajouterALaBoite(boite: MessageSimule[], message: MessageSimule): void {
  boite.push(message);
  if (boite.length > TAILLE_BOITE_SIMULEE) boite.shift();
}
