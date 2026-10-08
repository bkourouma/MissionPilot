import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { Config } from "../config.js";

/*
 * Chiffrement applicatif des secrets stockés en base (secret TOTP, charge des
 * e-mails en file d'attente) et empreintes à clé (codes de secours, clés du
 * limiteur de tentatives : e-mail normalisé, auth/limiteur.ts).
 *
 * - Clés dérivées par HKDF-SHA-256 d'un secret maître dédié (TFA_MASTER_KEY,
 *   distinct de SESSION_SECRET), avec un contexte dédié par usage : une clé ne
 *   sert jamais à deux usages.
 * - AES-256-GCM, nonce aléatoire de 96 bits par chiffrement, données associées
 *   (AAD) qui lient le chiffré à sa ligne : un chiffré recopié sur une autre
 *   ligne (autre utilisateur, autre cabinet) ne se déchiffre pas.
 * - Chaque chiffré porte sa version de clé (colonne `cle_version`) : un
 *   trousseau peut contenir l'ancienne clé le temps de rechiffrer (rotation).
 */

/** `ia_cle_api` : clé OpenRouter d'un cabinet ; `ia_entree` : entrée d'une génération IA (ia/). */
export type UsageCle =
  "totp" | "codes_secours" | "file_email" | "limiteur" | "ia_cle_api" | "ia_entree";

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

/** Version historique : chiffrés antérieurs à TFA_MASTER_KEY, dérivés de SESSION_SECRET. */
export const VERSION_HERITEE = 1;

/**
 * Version d'un secret maître : empreinte courte et stable (2 à 32 001,
 * colonne smallint), indépendante de l'ordre de configuration. Une rotation
 * n'exige donc aucune numérotation manuelle : la clé précédente garde la
 * version sous laquelle ses chiffrés ont été écrits.
 */
export function versionDeCle(secretMaitre: string): number {
  const h = createHash("sha256").update(`missionpilot/version-cle/${secretMaitre}`).digest();
  return 2 + (h.readUInt32BE(0) % 32_000);
}

/**
 * Trousseau de l'application (rotation, constat M4) :
 * - TFA_MASTER_KEY : clé COURANTE, seule à chiffrer ;
 * - TFA_MASTER_KEY_PRECEDENTE (facultative) : déchiffre encore les chiffrés
 *   écrits avant la rotation ;
 * - SESSION_SECRET : clé PRÉCÉDENTE IMPLICITE (version 1), pour les chiffrés
 *   écrits avant l'introduction de TFA_MASTER_KEY : aucun compte existant
 *   n'est verrouillé.
 * Les chiffrés anciens sont repris avec la clé courante à leur première
 * utilisation (vérification d'un code TOTP). Une collision de version entre
 * la clé courante et la précédente est refusée (changer l'une des deux).
 */
export function trousseauDepuisConfig(
  config: Pick<Config, "SESSION_SECRET" | "TFA_MASTER_KEY" | "TFA_MASTER_KEY_PRECEDENTE">,
): Trousseau {
  let t = trousseaux.get(config);
  if (!t) {
    const courante = versionDeCle(config.TFA_MASTER_KEY);
    const secrets: Record<number, string> = { [VERSION_HERITEE]: config.SESSION_SECRET };
    if (config.TFA_MASTER_KEY_PRECEDENTE) {
      const precedente = versionDeCle(config.TFA_MASTER_KEY_PRECEDENTE);
      if (precedente === courante) {
        throw new Error(
          "TFA_MASTER_KEY et TFA_MASTER_KEY_PRECEDENTE ont la même version : choisir une autre clé.",
        );
      }
      secrets[precedente] = config.TFA_MASTER_KEY_PRECEDENTE;
    }
    secrets[courante] = config.TFA_MASTER_KEY;
    t = creerTrousseau(secrets, courante);
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

/**
 * Déchiffre avec la clé de la version portée par le chiffré, puis, à défaut,
 * avec la clé courante et les autres clés du trousseau (l'étiquette GCM dit
 * laquelle convient). Lève une erreur si aucune ne convient : version
 * inconnue, chiffré altéré ou AAD différente.
 */
export function dechiffrer(t: Trousseau, usage: UsageCle, chiffre: Chiffre, aad: string): Buffer {
  if (chiffre.donnees.length < NONCE + ETIQUETTE + 1) throw new Error("Chiffré invalide.");
  const ordre = [
    chiffre.version,
    t.versionActuelle,
    ...t.versions().filter((v) => v !== chiffre.version && v !== t.versionActuelle),
  ];
  let derniere: unknown = null;
  for (const version of [...new Set(ordre)]) {
    const cle = t.cle(usage, version);
    if (!cle) continue;
    try {
      return dechiffrerAvec(cle, chiffre, aad);
    } catch (error) {
      derniere = error;
    }
  }
  if (!t.cle(usage, chiffre.version)) throw new Error("Version de clé inconnue.");
  throw derniere instanceof Error ? derniere : new Error("Chiffré invalide.");
}

function dechiffrerAvec(cle: Buffer, chiffre: Chiffre, aad: string): Buffer {
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
