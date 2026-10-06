import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * TOTP (RFC 6238) sur HOTP (RFC 4226) : HMAC-SHA-1, 6 chiffres, pas de 30 s,
 * tolérance d'un pas avant et après. node:crypto uniquement.
 */

export const PAS_SECONDES = 30;
export const CHIFFRES = 6;
export const FENETRE = 1;
/** 160 bits, taille recommandée par la RFC 4226 pour HMAC-SHA-1. */
export const TAILLE_SECRET = 20;

const ALPHABET_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 RFC 4648 sans remplissage (format attendu par les applications d'authentification). */
export function base32Encoder(donnees: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = "";
  for (const octet of donnees) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET_BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
    valeur &= (1 << bits) - 1;
  }
  if (bits > 0) sortie += ALPHABET_BASE32[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function base32Decoder(texte: string): Buffer {
  const propre = texte.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const c of propre) {
    const i = ALPHABET_BASE32.indexOf(c);
    if (i < 0) throw new Error("Base32 invalide.");
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    valeur &= (1 << bits) - 1;
  }
  return Buffer.from(octets);
}

/** HOTP (RFC 4226, troncature dynamique). */
export function hotp(secret: Buffer, compteur: number, chiffres = CHIFFRES): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(compteur));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const decalage = hmac[hmac.length - 1]! & 0x0f;
  const binaire = hmac.readUInt32BE(decalage) & 0x7fffffff;
  return String(binaire % 10 ** chiffres).padStart(chiffres, "0");
}

/** Pas de temps (compteur TOTP) à l'instant `ms`. */
export function pasDe(ms: number): number {
  return Math.floor(ms / 1000 / PAS_SECONDES);
}

export function totp(secret: Buffer, ms: number, chiffres = CHIFFRES): string {
  return hotp(secret, pasDe(ms), chiffres);
}

function egaux(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Vérifie un code dans la fenêtre ±1 pas. Renvoie le pas reconnu, ou null.
 * Anti-rejeu : un pas inférieur ou égal à `dernierPas` est refusé. Les trois
 * pas sont toujours calculés et comparés à temps constant.
 */
export function verifierTotp(
  secret: Buffer,
  code: string,
  ms: number,
  dernierPas: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const courant = pasDe(ms);
  let reconnu: number | null = null;
  for (let d = -FENETRE; d <= FENETRE; d++) {
    const pas = courant + d;
    if (pas < 0) continue;
    const ok = egaux(hotp(secret, pas), code);
    if (ok && reconnu === null && (dernierPas === null || pas > dernierPas)) reconnu = pas;
  }
  return reconnu;
}

export function nouveauSecretTotp(): Buffer {
  return randomBytes(TAILLE_SECRET);
}

/** URI d'enrôlement (QR code) : otpauth://totp/Émetteur:compte?secret=…&issuer=… */
export function uriOtpauth(secret: Buffer, compte: string, emetteur = "MissionPilot"): string {
  const libelle = `${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}`;
  const params = new URLSearchParams({
    secret: base32Encoder(secret),
    issuer: emetteur,
    algorithm: "SHA1",
    digits: String(CHIFFRES),
    period: String(PAS_SECONDES),
  });
  return `otpauth://totp/${libelle}?${params.toString()}`;
}
