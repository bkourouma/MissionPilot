import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { Role } from "@missionpilot/shared";
import type { Config } from "./config.js";
import type { Database } from "./db/pool.js";
import { AppError } from "./errors.js";
import { COOKIE_SESSION, hacherJeton } from "./auth/session.js";
import { rolesObligatoires } from "./auth/double-authentification.js";
import { creerMailer, type Mailer } from "./notifications/mailer.js";
import { routesAuth } from "./routes/auth.js";
import { routesFacturation } from "./routes/facturation-routes.js";
import { routesFinance } from "./routes/finance-routes.js";
import { routesDocumentsCollaboration } from "./routes/documents-routes.js";
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
  interface FastifyRequest {
    /** Soumis à la politique 2FA du cabinet sans l'avoir activée (crochet preHandler). */
    tfaAConfigurer: boolean;
  }
}

/** Routes accessibles sans 2FA à un utilisateur qui doit la configurer. */
export function routeLibreSans2fa(motif: string | undefined): boolean {
  if (motif === undefined) return false;
  return (
    motif === "/api/sante" ||
    motif.startsWith("/api/auth/") ||
    motif === "/api/invitations/accepter"
  );
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
  app.decorateRequest("tfaAConfigurer", false);

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  app.addHook("onRequest", async (request) => {
    const jeton = request.cookies[COOKIE_SESSION];
    if (!jeton) return;
    const resolue = await db.withoutTenant(async (client) => {
      const r = await client.query("SELECT * FROM resoudre_session($1)", [hacherJeton(jeton)]);
      const session = r.rows[0] as
        | { utilisateur_id: string; cabinet_id: string; email: string; nom: string; roles: Role[] }
        | undefined;
      if (!session) return undefined;
      const t = await client.query("SELECT * FROM etat_tfa_session($1)", [hacherJeton(jeton)]);
      const tfa = t.rows[0] as { tfa_obligatoire: string[]; tfa_active: boolean } | undefined;
      return { session, tfa };
    });
    if (resolue) {
      const { session, tfa } = resolue;
      request.auth = {
        utilisateurId: session.utilisateur_id,
        cabinetId: session.cabinet_id,
        email: session.email,
        nom: session.nom,
        roles: session.roles,
      };
      const politique = rolesObligatoires(tfa?.tfa_obligatoire ?? [], config);
      request.tfaAConfigurer =
        !tfa?.tfa_active && session.roles.some((role) => politique.includes(role));
    }
  });

  /*
   * Politique 2FA APPLIQUÉE (SOC-02, constat M2) : un utilisateur soumis à la
   * politique de son cabinet (ou au plancher TOTP_REQUIS) qui n'a pas activé
   * sa 2FA ne reçoit que 403 TFA_A_CONFIGURER, sauf sur les routes qui lui
   * permettent de se connecter, de se déconnecter et de configurer sa 2FA.
   * Le motif de route (routeOptions.url) est comparé, jamais l'URL brute.
   */
  app.addHook("preHandler", async (request) => {
    if (!request.auth || !request.tfaAConfigurer) return;
    if (routeLibreSans2fa(request.routeOptions.url)) return;
    throw new AppError(
      403,
      "TFA_A_CONFIGURER",
      "La double authentification est obligatoire pour votre rôle : configurez-la pour continuer.",
    );
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
  await app.register(routesFacturation, { prefix: "/api" });
  await app.register(routesFinance, { prefix: "/api" });
  await app.register(routesDocumentsCollaboration, { prefix: "/api" });
  return app;
}
