import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEYLEN = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/** Format : scrypt$N$sel$empreinte (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || Number(n) !== N || !salt || !expected) return false;
  const key = await derive(password, Buffer.from(salt, "base64"));
  const wanted = Buffer.from(expected, "base64");
  return key.length === wanted.length && timingSafeEqual(key, wanted);
}

/** Hachage factice pour égaliser le temps de réponse quand l'e-mail est inconnu. */
export const FAUX_HASH =
  "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
