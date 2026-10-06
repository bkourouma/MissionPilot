import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import type { Config } from "../config.js";

/*
 * Chiffrement applicatif des secrets stockés en base (secret TOTP, charge des
 * e-mails en file d'attente) et empreintes à clé (codes de secours).
 *
 * - Clés dérivées par HKDF-SHA-256 d'un secret maître (SESSION_SECRET), avec
 *   un contexte dédié par usage : une clé ne sert jamais à deux usages.
 * - AES-256-GCM, nonce aléatoire de 96 bits par chiffrement, données associées
 *   (AAD) qui lient le chiffré à sa ligne : un chiffré recopié sur une autre
 *   ligne (autre utilisateur, autre cabinet) ne se déchiffre pas.
 * - Chaque chiffré porte sa version de clé (colonne `cle_version`) : un
 *   trousseau peut contenir l'ancienne clé le temps de rechiffrer (rotation).
 */

export type UsageCle = "totp" | "codes_secours" | "file_email";

export interface Trousseau {
  readonly versionActuelle: number;
  /** Clé de l'usage pour cette version, ou null si la version est inconnue. */
  cle(usage: UsageCle, version: number): Buffer | null;
  versions(): number[];
}

const SEL = Buffer.from("missionpilot/hkdf/v1");
const NONCE = 12;
const ETIQUETTE = 16;

/** Trousseau à partir des secrets maîtres par version ; la version actuelle chiffre. */
export function creerTrousseau(
  secrets: Record<number, string>,
  versionActuelle: number,
): Trousseau {
  if (!secrets[versionActuelle]) throw new Error("Version de clé actuelle absente du trousseau.");
  const cache = new Map<string, Buffer>();
  return {
    versionActuelle,
    versions: () => Object.keys(secrets).map(Number),
    cle(usage, version) {
      const maitre = secrets[version];
      if (!maitre) return null;
      const id = `${usage}:${version}`;
      let cle = cache.get(id);
      if (!cle) {
        const info = Buffer.from(`missionpilot/${usage}/v${version}`);
        cle = Buffer.from(hkdfSync("sha256", Buffer.from(maitre, "utf8"), SEL, info, 32));
        cache.set(id, cle);
      }
      return cle;
    },
  };
}

const trousseaux = new WeakMap<object, Trousseau>();

/**
 * Trousseau de l'application : version 1 = SESSION_SECRET. Dette : la
 * première rotation ajoutera une variable pour l'ancien secret, conservé
 * sous sa version le temps que les chiffrés soient repris (rechiffrement à
 * la volée lors de la vérification d'un code).
 */
export function trousseauDepuisConfig(config: Pick<Config, "SESSION_SECRET">): Trousseau {
  let t = trousseaux.get(config);
  if (!t) {
    t = creerTrousseau({ 1: config.SESSION_SECRET }, 1);
    trousseaux.set(config, t);
  }
  return t;
}

export interface Chiffre {
  version: number;
  /** nonce || étiquette || chiffré */
  donnees: Buffer;
}

export function chiffrer(t: Trousseau, usage: UsageCle, clair: Buffer, aad: string): Chiffre {
  const cle = t.cle(usage, t.versionActuelle)!;
  const nonce = randomBytes(NONCE);
  const c = createCipheriv("aes-256-gcm", cle, nonce);
  c.setAAD(Buffer.from(aad, "utf8"));
  const corps = Buffer.concat([c.update(clair), c.final()]);
  return { version: t.versionActuelle, donnees: Buffer.concat([nonce, c.getAuthTag(), corps]) };
}

/** Lève une erreur si la version est inconnue, le chiffré altéré ou l'AAD différente. */
export function dechiffrer(t: Trousseau, usage: UsageCle, chiffre: Chiffre, aad: string): Buffer {
  const cle = t.cle(usage, chiffre.version);
  if (!cle) throw new Error("Version de clé inconnue.");
  if (chiffre.donnees.length < NONCE + ETIQUETTE + 1) throw new Error("Chiffré invalide.");
  const nonce = chiffre.donnees.subarray(0, NONCE);
  const etiquette = chiffre.donnees.subarray(NONCE, NONCE + ETIQUETTE);
  const corps = chiffre.donnees.subarray(NONCE + ETIQUETTE);
  const d = createDecipheriv("aes-256-gcm", cle, nonce);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(etiquette);
  return Buffer.concat([d.update(corps), d.final()]);
}

/** Empreinte HMAC-SHA-256 à clé dérivée (hex) : une fuite de la base seule ne permet pas de la recalculer. */
export function empreinte(t: Trousseau, usage: UsageCle, version: number, valeur: string): string {
  const cle = t.cle(usage, version);
  if (!cle) throw new Error("Version de clé inconnue.");
  return createHmac("sha256", cle).update(valeur, "utf8").digest("hex");
}
