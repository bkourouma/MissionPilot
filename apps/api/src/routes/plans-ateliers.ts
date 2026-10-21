import type { FastifyPluginAsync } from "fastify";
import {
  atelierCreationSchema,
  atelierMethodeParamsSchema,
  atelierModificationSchema,
  atelierParamsSchema,
  atelierParticipantSchema,
  ateliersListeQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "../plans/acces.js";
import {
  candidatsAtelier,
  cloreAtelier,
  creerAtelier,
  exigerAtelier,
  inviterParticipant,
  listerAteliers,
  lireAtelier,
  modifierAtelier,
  ouvrirAtelier,
} from "../plans/ateliers.js";
import {
  deposerContribution,
  lireCorpsContribution,
  lireMaContribution,
  verrouillerContributions,
} from "../plans/ateliers-contributions.js";
import { traduireErreurAtelier } from "../plans/ateliers-erreurs.js";
import { genererSyntheseAtelier, lireSyntheseAtelier } from "../plans/ateliers-synthese.js";
import { traduireErreurPlan } from "../plans/erreurs.js";

/*
 * Ateliers stratégiques en ligne (PLA-15), montés par routes/plans.ts sous /api. Un atelier d'un autre
 * cabinet, d'un plan ou d'une mission invisibles répond 404 ; une écriture sur une mission clôturée, 409.
 *
 * - GET /plans/:id/ateliers, GET /plans/:id/ateliers/:atelierId (« plan.lire ») : liste et détail ;
 *   agrégats du moteur après la clôture seulement, taux de participation pendant l'atelier, jamais une
 *   contribution individuelle (anonymat) ;
 * - POST /plans/:id/ateliers, PATCH /plans/:id/ateliers/:atelierId (brouillon), POST …/ouvrir,
 *   POST …/clore, POST …/participants (« plan.ecrire » ; « portail.gerer » en plus pour inviter un
 *   dirigeant du client), GET …/candidats (« plan.ecrire ») ;
 * - GET et PUT …/contribution(/:methode) (« plan.lire », participant invité) : SA contribution seule ;
 * - POST et GET …/synthese (« plan.ecrire » et « ia.utiliser » pour générer ; « plan.lire » pour lire) :
 *   brouillon IA validé par la route /ia/generations/:id/valider.
 * Rien n'est ouvert au portail ici : ses routes sont dans routes/portail-ateliers.ts.
 */
export const routesPlansAteliers: FastifyPluginAsync = async (app) => {
  // Traduit les SQLSTATE MQL…, puis laisse le gestionnaire du plan traduire le reste (MPS…, moteur).
  app.setErrorHandler(async (error) => {
    throw traduireErreurPlan(traduireErreurAtelier(error));
  });

  const deps = () => ({ config: app.config, journal: (e: unknown) => app.log.info({ ia: e }) });

  app.get("/plans/:id/ateliers", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = ateliersListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerAteliers(db, auth, id, q));
  });

  app.post("/plans/:id/ateliers", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = atelierCreationSchema.parse(request.body);
    const atelier = await app.db.withTenant(auth.cabinetId, (db) =>
      creerAtelier(db, auth, id, corps),
    );
    return reply.status(201).send(atelier);
  });

  app.get("/plans/:id/ateliers/:atelierId", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireAtelier(db, auth, id, atelierId));
  });

  app.patch("/plans/:id/ateliers/:atelierId", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    const corps = atelierModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      modifierAtelier(db, auth, id, atelierId, corps),
    );
  });

  app.post("/plans/:id/ateliers/:atelierId/ouvrir", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => ouvrirAtelier(db, auth, id, atelierId));
  });

  app.post("/plans/:id/ateliers/:atelierId/clore", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => cloreAtelier(db, auth, id, atelierId));
  });

  app.get("/plans/:id/ateliers/:atelierId/candidats", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => candidatsAtelier(db, auth, id, atelierId));
  });

  app.post("/plans/:id/ateliers/:atelierId/participants", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    const { utilisateur_id } = atelierParticipantSchema.parse(request.body);
    const p = await app.db.withTenant(auth.cabinetId, (db) =>
      inviterParticipant(db, auth, id, atelierId, utilisateur_id),
    );
    return reply.status(201).send(p);
  });

  /* ----- SA contribution (membre du cabinet invité) ----- */

  app.get("/plans/:id/ateliers/:atelierId/contribution", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerPlanVisible(db, auth, id);
      await exigerAtelier(db, id, atelierId);
      return { contributions: await lireMaContribution(db, atelierId, auth.utilisateurId) };
    });
  });

  app.put("/plans/:id/ateliers/:atelierId/contribution/:methode", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, atelierId, methode } = atelierMethodeParamsSchema.parse(request.params);
    const corps = lireCorpsContribution(methode, request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Mission visible (404) ; la mission clôturée ferme aussi les contributions (409).
      const plan = await exigerPlanRedigeable(db, auth, id);
      await verrouillerContributions(db, atelierId);
      const atelier = await exigerAtelier(db, id, atelierId);
      const depot = await deposerContribution(
        db,
        atelier,
        { cabinetId: auth.cabinetId, utilisateurId: auth.utilisateurId, clientId: null },
        methode,
        corps,
        interdit,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "plan.atelier.contribuer",
        entite: "plan_atelier",
        entiteId: atelierId,
        details: { plan_id: plan.id, methode, version: depot.version, lignes: depot.lignes },
      });
      return { methode, version: depot.version };
    });
  });

  /* ----- Synthèse IA ----- */

  app.post("/plans/:id/ateliers/:atelierId/synthese", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    exiger(request, "ia.utiliser");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    const { synthese, resultat } = await genererSyntheseAtelier(
      app.db,
      deps(),
      auth,
      id,
      atelierId,
    );
    await envoyerEmails(app.mailer, resultat.notifications, (m) => app.log.warn(m));
    return reply.status(201).send({ synthese });
  });

  app.get("/plans/:id/ateliers/:atelierId/synthese", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, atelierId } = atelierParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireSyntheseAtelier(db, auth, id, atelierId));
  });
};
