import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { Role } from "@missionpilot/shared";
import type { Config } from "./config.js";
import type { Database } from "./db/pool.js";
import { AppError } from "./errors.js";
import { COOKIE_SESSION, hacherJeton } from "./auth/session.js";
import { routesAuth } from "./routes/auth.js";
import { routesSante } from "./routes/sante.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: Config;
  }
}

export async function buildApp(config: Config, db: Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.NODE_ENV !== "test", bodyLimit: 1_048_576 });
  app.decorate("db", db);
  app.decorate("config", config);
  app.decorateRequest("auth", null);

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  app.addHook("onRequest", async (request) => {
    const jeton = request.cookies[COOKIE_SESSION];
    if (!jeton) return;
    const resolue = await db.withoutTenant(async (client) => {
      const r = await client.query("SELECT * FROM resoudre_session($1)", [hacherJeton(jeton)]);
      return r.rows[0] as
        | { utilisateur_id: string; cabinet_id: string; email: string; nom: string; roles: Role[] }
        | undefined;
    });
    if (resolue) {
      request.auth = {
        utilisateurId: resolue.utilisateur_id,
        cabinetId: resolue.cabinet_id,
        email: resolue.email,
        nom: resolue.nom,
        roles: resolue.roles,
      };
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statut)
        .send({ erreur: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        erreur: {
          code: "REQUETE_INVALIDE",
          message: "Données invalides.",
          details: error.flatten(),
        },
      });
    }
    const statut = (error as { statusCode?: number }).statusCode;
    if (statut && statut >= 400 && statut < 500) {
      return reply
        .status(statut)
        .send({ erreur: { code: "REQUETE_INVALIDE", message: "Requête invalide." } });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ erreur: { code: "ERREUR_INTERNE", message: "Erreur interne." } });
  });

  await app.register(routesSante, { prefix: "/api" });
  await app.register(routesAuth, { prefix: "/api/auth" });
  return app;
}
