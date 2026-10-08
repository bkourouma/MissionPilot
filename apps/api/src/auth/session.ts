import { createHash, randomBytes } from "node:crypto";

export const COOKIE_SESSION = "mp_session";
export const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;

export function nouveauJeton(): string {
  return randomBytes(32).toString("base64url");
}

/** Seul le haché du jeton est stocké : une fuite de la base ne donne pas de session. */
export function hacherJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}
