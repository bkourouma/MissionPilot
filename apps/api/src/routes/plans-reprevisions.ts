import type { FastifyPluginAsync } from "fastify";
import {
  planRealiseParamsSchema,
  planRealiseSaisieSchema,
  planRealisesQuerySchema,
  planReprevisionCreationSchema,
  planReprevisionListeQuerySchema,
  planReprevisionParamsSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { traduireErreurPlan } from "../plans/erreurs.js";
import { lireRealises, saisirRealise } from "../plans/realises.js";
import { creerReprevision, lireReprevisionPlan, listerReprevisions } from "../plans/reprevision.js";
import { traduireErreurReprevision } from "../plans/reprevision-erreurs.js";
import {
  genererExplicationReprevision,
  lireExplicationReprevision,
} from "../plans/reprevision-explication.js";

/*
 * Plan vivant (PLA-18) : réalisés trimestriels et re-prévisions, monté par routes/plans.ts sous /api. Un
 * plan d'un autre cabinet ou d'une mission invisible répond 404 ; une écriture sur une mission clôturée,
 * 409. Rien n'est ouvert au portail client (aucune ligne de la liste blanche, politique `portail_interdit`
 * sur les deux tables). États financiers du CLIENT : réservés comme le reste du plan (« plan.lire » /
 * « plan.ecrire »), jamais le gestionnaire ni le responsable des ressources.
 *
 * - PUT /plans/:id/realises/:exercice/:trimestre (« plan.ecrire ») : saisit ou corrige un réalisé (nouvelle
 *   version, trimestres consécutifs) ; GET /plans/:id/realises?exercice= (« plan.lire ») : réalisés
 *   courants et historique des versions ;
 * - POST /plans/:id/reprevisions (« plan.ecrire ») : relit les réalisés courants, appelle le moteur,
 *   enregistre ; version du modèle non validée → 409 ; erreur du moteur → 400 REPREVISION_INVALIDE ;
 * - GET /plans/:id/reprevisions, GET …/:revId (« plan.lire ») : liste paginée et détail (résultat complet
 *   du moteur) ;
 * - POST et GET …/:revId/explication (« plan.ecrire » et « ia.utiliser » pour générer ; « plan.lire »
 *   pour lire) : brouillon IA validé par la route /ia/generations/:id/valider.
 */
export const routesPlansReprevisions: FastifyPluginAsync = async (app) => {
  // Traduit les SQLSTATE MQL15 à MQL24, puis laisse le gestionnaire du plan traduire le reste.
  app.setErrorHandler(async (error) => {
    throw traduireErreurPlan(traduireErreurReprevision(error));
  });

  const deps = () => ({ config: app.config, journal: (e: unknown) => app.log.info({ ia: e }) });

  /* ----- Réalisés ----- */

  app.put("/plans/:id/realises/:exercice/:trimestre", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, exercice, trimestre } = planRealiseParamsSchema.parse(request.params);
    const corps = planRealiseSaisieSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      saisirRealise(db, auth, id, exercice, trimestre, corps),
    );
  });

  app.get("/plans/:id/realises", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { exercice } = planRealisesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireRealises(db, auth, id, exercice));
  });

  /* ----- Re-prévisions ----- */

  app.post("/plans/:id/reprevisions", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planReprevisionCreationSchema.parse(request.body);
    const rev = await app.db.withTenant(auth.cabinetId, (db) =>
      creerReprevision(db, auth, id, corps),
    );
    return reply.status(201).send(rev);
  });

  app.get("/plans/:id/reprevisions", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = planReprevisionListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerReprevisions(db, auth, id, q));
  });

  app.get("/plans/:id/reprevisions/:revId", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, revId } = planReprevisionParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireReprevisionPlan(db, auth, id, revId));
  });

  /* ----- Explication IA ----- */

  app.post("/plans/:id/reprevisions/:revId/explication", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    exiger(request, "ia.utiliser");
    const { id, revId } = planReprevisionParamsSchema.parse(request.params);
    const { explication, resultat } = await genererExplicationReprevision(
      app.db,
      deps(),
      auth,
      id,
      revId,
    );
    await envoyerEmails(app.mailer, resultat.notifications, (m) => app.log.warn(m));
    return reply.status(201).send({ explication });
  });

  app.get("/plans/:id/reprevisions/:revId/explication", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, revId } = planReprevisionParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      lireExplicationReprevision(db, auth, id, revId),
    );
  });
};
