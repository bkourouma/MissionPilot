import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { Role } from "@missionpilot/shared";
import { estLocal, type Config } from "./config.js";
import type { Database } from "./db/pool.js";
import { AppError, detailsPublics } from "./errors.js";
import { COOKIE_SESSION, hacherJeton } from "./auth/session.js";
import { rolesObligatoires } from "./auth/double-authentification.js";
import { creerMailer, type Mailer } from "./notifications/mailer.js";
import { routesAgents } from "./routes/agents.js";
import { routesAuth } from "./routes/auth.js";
import { routesDossierClient } from "./routes/dossier-client.js";
import { routesFacturation } from "./routes/facturation-routes.js";
import { routesFinance } from "./routes/finance-routes.js";
import { routesIa } from "./routes/ia-routes.js";
import { routesDocumentsCollaboration } from "./routes/documents-routes.js";
import { routesCycleMission } from "./routes/missions-routes.js";
import { routesPlanification } from "./routes/planification-routes.js";
import { installerGardePortail } from "./portail/garde.js";
import { routesPortail } from "./routes/portail.js";
import { routesPreuves } from "./routes/preuves.js";
import { routesQualite } from "./routes/qualite.js";
import { routesReferentiels } from "./routes/referentiels.js";
import { routesSante } from "./routes/sante.js";
import { routesStandard } from "./routes/standard.js";
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
    motif === "/api/invitations/accepter" ||
    motif === "/api/portail/invitations/accepter"
  );
}

/** Méthodes qui modifient l'état : soumises à la garde d'origine. */
const METHODES_MODIFIANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Origine sérialisée (`schéma://hôte[:port]`) d'une URL de configuration (WEB_ORIGIN). */
export function origineDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Garde d'origine (CSRF), en complément du cookie `SameSite=Lax` : vrai si une requête
 * modifiante (POST, PUT, PATCH, DELETE) porte un en-tête `Origin` différent de l'origine du
 * web, comparée telle quelle (ni préfixe, ni suffixe, ni casse). `null` (document sandboxé,
 * redirection entre origines, fichier local) est toujours refusé, même si WEB_ORIGIN est
 * illisible et sérialisé en « null ». Sans en-tête `Origin` (client hors navigateur, appel
 * serveur du web, `inject` des tests), la requête suit : session et permission restent
 * exigées par la route.
 */
export function origineRefusee(
  methode: string,
  origine: string | string[] | undefined,
  origineWeb: string | ReadonlySet<string>,
): boolean {
  if (!METHODES_MODIFIANTES.has(methode) || origine === undefined) return false;
  if (origine === "null" || Array.isArray(origine)) return true;
  return typeof origineWeb === "string" ? origine !== origineWeb : !origineWeb.has(origine);
}

/**
 * Origines acceptées : celle de WEB_ORIGIN et, en développement ou en test seulement, ses
 * alias de boucle locale (localhost, 127.0.0.1, [::1]) au même schéma et au même port, pour que
 * le web ouvert sur http://127.0.0.1:3100 ne soit pas refusé. Jamais d'alias en production.
 */
export function originesAcceptees(origineWeb: string, nodeEnv: string | undefined): Set<string> {
  const acceptees = new Set([origineWeb]);
  if (!estLocal(nodeEnv)) return acceptees;
  try {
    const u = new URL(origineWeb);
    if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) {
      for (const h of ["localhost", "127.0.0.1", "[::1]"]) {
        const alias = new URL(origineWeb);
        alias.hostname = h;
        acceptees.add(alias.origin);
      }
    }
  } catch {
    // WEB_ORIGIN illisible : seule la valeur brute est acceptée.
  }
  return acceptees;
}

/**
 * Délai maximal de RÉCEPTION d'une requête entière (en-têtes et corps), en millisecondes.
 * Fastify le désactive par défaut (0) : un client qui envoie son corps goutte à goutte
 * garderait la connexion, sa mémoire et son tampon multipart indéfiniment. Cinq minutes
 * (le défaut de Node) laissent à un fichier du plafond par défaut (15 Mo) un débit
 * d'environ 50 Ko/s, bien en deçà d'une liaison mobile médiocre. Ne borne pas la durée
 * du traitement ni de la réponse (rendu PDF, génération IA).
 */
export const DELAI_RECEPTION_REQUETE_MS = 300_000;

export async function buildApp(
  config: Config,
  db: Database,
  options: { mailer?: Mailer } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: 1_048_576,
    requestTimeout: DELAI_RECEPTION_REQUETE_MS,
  });
  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("mailer", options.mailer ?? creerMailer(config));
  app.decorateRequest("auth", null);
  app.decorateRequest("tfaAConfigurer", false);

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  /*
   * Garde d'origine (CSRF, `origineRefusee`), AVANT la session et toute lecture du corps :
   * un formulaire d'un autre site poste du multipart, du texte ou de l'urlencodé sans
   * pré-requête CORS, mais le navigateur joint toujours `Origin` à un POST, PUT, PATCH ou
   * DELETE, même en même origine. Hypothèses : le relais Next (réécriture `/api/*`,
   * http-proxy en `changeOrigin`) ne réécrit que `Host` et transmet l'`Origin` du
   * navigateur ; les appels serveur du web (`lib/api-serveur.ts`, fetch de Node) n'en
   * envoient pas. En production, le web doit être ouvert à
   * l'adresse exacte de WEB_ORIGIN ; en développement et en test, localhost, 127.0.0.1 et
   * [::1] (même port) sont équivalents (`originesAcceptees`).
   */
  const origineWeb = originesAcceptees(origineDe(config.WEB_ORIGIN), config.NODE_ENV);
  app.addHook("onRequest", async (request) => {
    if (origineRefusee(request.method, request.headers.origin, origineWeb)) {
      throw new AppError(403, "ORIGINE_REFUSEE", "Requête refusée : origine non autorisée.");
    }
  });

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

  // Portail client (SOC-09) : liste blanche stricte et contexte du client (portail/garde.ts).
  installerGardePortail(app);

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
      // `details` : liste blanche de champs (CHAMPS_DETAILS_PUBLICS, errors.ts).
      const details = detailsPublics(error.details);
      return reply.status(error.statut).send({
        erreur: { code: error.code, message: error.message, ...(details ? { details } : {}) },
      });
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
  // Connexion rapide de démonstration : AUCUNE route sans CONNEXION_RAPIDE_DEMO=oui en local.
  await app.register((await import("./routes/connexion-demo.js")).routesConnexionDemo, {
    prefix: "/api/auth",
  });
  await app.register(routesReferentiels, { prefix: "/api" });
  await app.register(routesCycleMission, { prefix: "/api" });
  await app.register(routesPlanification, { prefix: "/api" });
  await app.register(routesTemps, { prefix: "/api" });
  await app.register(routesFacturation, { prefix: "/api" });
  await app.register(routesFinance, { prefix: "/api" });
  await app.register(routesDocumentsCollaboration, { prefix: "/api" });
  await app.register((await import("./routes/rapports.js")).routesRapports, { prefix: "/api" });
  await app.register(routesIa, { prefix: "/api" });
  await app.register((await import("./routes/plans.js")).routesPlans, { prefix: "/api" });
  await app.register((await import("./routes/kpi.js")).routesKpi, { prefix: "/api" });
  await app.register((await import("./routes/questionnaires.js")).routesQuestionnaires, {
    prefix: "/api",
  });
  await app.register((await import("./routes/limiteur-admin.js")).routesLimiteurAdmin, {
    prefix: "/api",
  });
  // Vague 1 (V3, ADR-004 et ADR-005) : plugins posés vides par la phase 1, remplis chacun
  // par son lot (STD, DOS, PRV, AGT, QUA) sans retoucher ce fichier.
  await app.register(routesStandard, { prefix: "/api" });
  await app.register(routesDossierClient, { prefix: "/api" });
  await app.register(routesPreuves, { prefix: "/api" });
  await app.register(routesAgents, { prefix: "/api" });
  await app.register(routesQualite, { prefix: "/api" });
  await app.register(routesPortail, { prefix: "/api/portail" });
  return app;
}
