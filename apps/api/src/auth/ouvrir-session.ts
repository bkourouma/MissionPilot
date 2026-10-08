import type { FastifyReply } from "fastify";
import { cookieSecurise, type Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { COOKIE_SESSION, DUREE_SESSION_MS, hacherJeton, nouveauJeton } from "./session.js";

/** Crée une session dans la transaction courante ; renvoie le jeton en clair (seul son haché est stocké). */
export async function creerSession(
  db: Db,
  cabinetId: string,
  utilisateurId: string,
): Promise<string> {
  const jeton = nouveauJeton();
  await db.query(
    `INSERT INTO sessions (cabinet_id, utilisateur_id, jeton_hash, expire_le)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
    [cabinetId, utilisateurId, hacherJeton(jeton), String(DUREE_SESSION_MS)],
  );
  return jeton;
}

/** À appeler après la validation de la transaction, mêmes attributs que la connexion. */
export function poserCookieSession(reply: FastifyReply, config: Config, jeton: string): void {
  reply.setCookie(COOKIE_SESSION, jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecurise(config),
    path: "/",
    maxAge: DUREE_SESSION_MS / 1000,
  });
}
