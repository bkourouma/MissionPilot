import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { Role } from "@missionpilot/shared";
import type { Config } from "./config.js";
import type { Database } from "./db/pool.js";
import { AppError } from "./errors.js";
import { COOKIE_SESSION, hacherJeton } from "./auth/session.js";
import { creerMailer, type Mailer } from "./notifications/mailer.js";
import { routesAuth } from "./routes/auth.js";
import { routesCycleMission } from "./routes/missions-routes.js";
import { routesPlanification } from "./routes/planification-routes.js";
import { routesReferentiels } from "./routes/referentiels.js";
import { routesSante } from "./routes/sante.js";
import { routesTemps } from "./routes/temps-routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: Config;
  }
}

export async function buildApp(
  config: Config,
  db: Database,
  options: { mailer?: Mailer } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: 1_048_576,
  });
  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("mailer", options.mailer ?? creerMailer(config));
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
    // Pas d'objet d'erreur complet : le champ `detail` de PostgreSQL peut citer des données.
    const pgErreur = error as {
      message?: string;
      code?: string;
      constraint?: string;
      table?: string;
    };
    request.log.error({
      message: pgErreur.message,
      code: pgErreur.code,
      constraint: pgErreur.constraint,
      table: pgErreur.table,
    });
    return reply
      .status(500)
      .send({ erreur: { code: "ERREUR_INTERNE", message: "Erreur interne." } });
  });

  await app.register(routesSante, { prefix: "/api" });
  await app.register(routesAuth, { prefix: "/api/auth" });
  await app.register(routesReferentiels, { prefix: "/api" });
  await app.register(routesCycleMission, { prefix: "/api" });
  await app.register(routesPlanification, { prefix: "/api" });
  await app.register(routesTemps, { prefix: "/api" });
  return app;
}
