import type { FastifyReply } from "fastify";
import { cookieSecurise, type Config } from "../config.js";

/** Cookie de la session plateforme : distinct de `mp_session`, jamais lu par les routes de cabinet. */
export const COOKIE_PLATEFORME = "mp_plateforme";
/** Durée de la session plateforme (8 h) : alignée sur la durée fixe décidée en SQL. */
export const DUREE_SESSION_PLATEFORME_MS = 8 * 60 * 60 * 1000;

/** Super admin résolu depuis le cookie ; `jetonHash` ne quitte jamais le serveur. */
export interface SessionPlateforme {
  superAdminId: string;
  email: string;
  nom: string;
  estDemo: boolean;
  jetonHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Session plateforme résolue par le crochet du plugin `routesPlateforme`, sinon null. */
    plateforme: SessionPlateforme | null;
  }
}

/** À appeler après la validation de la transaction qui a ouvert la session. */
export function poserCookiePlateforme(reply: FastifyReply, config: Config, jeton: string): void {
  reply.setCookie(COOKIE_PLATEFORME, jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecurise(config),
    path: "/",
    maxAge: DUREE_SESSION_PLATEFORME_MS / 1000,
  });
}

export function effacerCookiePlateforme(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_PLATEFORME, { path: "/" });
}
