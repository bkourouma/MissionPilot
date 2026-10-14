import {
  chiffrer,
  dechiffrer,
  empreinte,
  type Chiffre,
  type Trousseau,
} from "../auth/chiffrement.js";
import type { CanalMessagerie } from "@missionpilot/shared";

/*
 * Cryptographie des numéros de téléphone des destinataires (SPEC-3c §5.2) : aucun SQL ici. Le numéro
 * n'est JAMAIS stocké en clair : AES-256-GCM (usage `canal_numero`, AAD liée à la ligne : un chiffré
 * recopié sur un autre utilisateur, canal ou cabinet ne se déchiffre pas) ; empreinte HMAC (usage
 * `canal_empreinte`) pour retrouver l'expéditeur d'un message ; le code de vérification n'existe
 * qu'en empreinte HMAC (usage `canal_code`) ; les variables d'un envoi en file sont chiffrées (usage
 * `canal_charge`).
 */

export const aadNumero = (cabinetId: string, utilisateurId: string, canal: CanalMessagerie) =>
  `canal_numero:${cabinetId}:${utilisateurId}:${canal}`;

export function chiffrerNumero(trousseau: Trousseau, numero: string, aad: string): Chiffre {
  return chiffrer(trousseau, "canal_numero", Buffer.from(numero, "utf8"), aad);
}

export function dechiffrerNumero(trousseau: Trousseau, chiffre: Chiffre, aad: string): string {
  return dechiffrer(trousseau, "canal_numero", chiffre, aad).toString("utf8");
}

const valeurEmpreinteNumero = (cabinetId: string, canal: CanalMessagerie, numero: string) =>
  `numero:${cabinetId}:${canal}:${numero}`;

/** Empreinte du numéro avec la clé de CETTE version du trousseau. */
export function empreinteNumero(
  trousseau: Trousseau,
  version: number,
  cabinetId: string,
  canal: CanalMessagerie,
  numero: string,
): string {
  return empreinte(
    trousseau,
    "canal_empreinte",
    version,
    valeurEmpreinteNumero(cabinetId, canal, numero),
  );
}

/**
 * Empreintes du numéro pour CHAQUE version du trousseau : une recherche les essaie toutes, sinon une
 * rotation de TFA_MASTER_KEY rendrait tous les expéditeurs inconnus.
 */
export function empreintesToutesVersions(
  trousseau: Trousseau,
  cabinetId: string,
  canal: CanalMessagerie,
  numero: string,
): { version: number; empreinte: string }[] {
  return trousseau.versions().map((version) => ({
    version,
    empreinte: empreinteNumero(trousseau, version, cabinetId, canal, numero),
  }));
}

/** Empreinte HMAC d'un code de vérification (liée au destinataire : un code ne vaut qu'une ligne). */
export function empreinteCode(
  trousseau: Trousseau,
  version: number,
  destinataireId: string,
  code: string,
): string {
  return empreinte(trousseau, "canal_code", version, `code:${destinataireId}:${code}`);
}

/** Empreinte HMAC du texte rendu d'un envoi (jamais le texte lui-même en base). */
export function empreinteContenu(trousseau: Trousseau, texte: string): string {
  return empreinte(trousseau, "canal_empreinte", trousseau.versionActuelle, `texte:${texte}`);
}

/** Variables d'un envoi en file, chiffrées dans la charge du job (le code n'y est jamais en clair). */
export const aadCharge = (cabinetId: string, envoiId: string) =>
  `canal_charge:${cabinetId}:${envoiId}`;

export function chiffrerVariables(
  trousseau: Trousseau,
  cabinetId: string,
  envoiId: string,
  variables: readonly string[],
): { v: number; d: string } {
  const c = chiffrer(
    trousseau,
    "canal_charge",
    Buffer.from(JSON.stringify(variables), "utf8"),
    aadCharge(cabinetId, envoiId),
  );
  return { v: c.version, d: c.donnees.toString("base64") };
}

export function dechiffrerVariables(
  trousseau: Trousseau,
  cabinetId: string,
  envoiId: string,
  charge: { v: number; d: string },
): string[] {
  const clair = dechiffrer(
    trousseau,
    "canal_charge",
    { version: charge.v, donnees: Buffer.from(charge.d, "base64") },
    aadCharge(cabinetId, envoiId),
  );
  const valeurs: unknown = JSON.parse(clair.toString("utf8"));
  if (!Array.isArray(valeurs) || valeurs.some((x) => typeof x !== "string")) {
    throw new Error("Variables d'envoi illisibles.");
  }
  return valeurs as string[];
}
