import type { FastifyPluginAsync } from "fastify";
import {
  redActionCreationSchema,
  redActionDeplacementSchema,
  redActionModificationSchema,
  redCommentaireSchema,
  redLevierSimulationSchema,
  redPlanValidationSchema,
  redPlanVersionCreationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import {
  actionEcriture,
  actionVisible,
  commenterAction,
  creerAction,
  deplacerAction,
  detailAction,
  modifierAction,
} from "../redressement/actions.js";
import { simulerLevier } from "../redressement/leviers.js";
import { creerVersionPlan, lirePlan, validerVersionPlan } from "../redressement/plan.js";

/*
 * Plan de redressement en deux volets, kanban d'actions, versions de plan et leviers (RED-05, RED-07
 * en partie, RED-14, routes 29 à 37), plugin de routes/redressement.ts. Droits : `redressement.lire`
 * (lecture, simulation), `redressement.ecrire` (actions, versions), `redressement.valider` (valider
 * une version de plan : RÉSERVÉ au directeur de la mission (hypothèse métier, `VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR` de redressement/plan.ts), jamais le créateur de la version sauf
 * associé, doublé en base MPZ07). La simulation d'un levier est un calcul pur : aucune écriture,
 * aucun journal. Les e-mails des notifications partent APRÈS la validation de la transaction.
 */
export const routesRedressementPlan: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/plan", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lirePlan(db, auth, await exigerDossierRedVisible(db, auth, id)),
    );
  });

  app.post("/redressement/dossiers/:id/actions", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redActionCreationSchema.parse(request.body);
    const ecrite = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerAction(db, auth, await exigerDossierRedEcriture(db, auth, id), corps),
    );
    await envoyerEmails(app.mailer, ecrite.notifications, (m) => request.log.warn(m));
    reply.status(201);
    return ecrite.vue;
  });

  app.patch("/redressement/actions/:id", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redActionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { acces, action } = await actionEcriture(db, auth, id);
      return modifierAction(db, auth, acces, action, corps);
    });
  });

  app.post("/redressement/actions/:id/deplacement", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redActionDeplacementSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      deplacerAction(db, auth, (await actionEcriture(db, auth, id)).action, corps),
    );
  });

  app.post("/redressement/actions/:id/commentaires", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCommentaireSchema.parse(request.body);
    const a = await app.db.withTenant(auth.cabinetId, async (db) =>
      commenterAction(db, auth, (await actionEcriture(db, auth, id)).action, corps.commentaire),
    );
    reply.status(201);
    return a;
  });

  app.get("/redressement/actions/:id", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailAction(db, (await actionVisible(db, auth, id)).action),
    );
  });

  app.post("/redressement/dossiers/:id/plan/versions", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redPlanVersionCreationSchema.parse(request.body ?? {});
    const v = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerVersionPlan(db, auth, await exigerDossierRedEcriture(db, auth, id), corps),
    );
    reply.status(201);
    return v;
  });

  app.post("/redressement/plan/versions/:id/validation", async (request) => {
    const auth = exiger(request, "redressement.valider");
    const { id } = paramsId.parse(request.params);
    const corps = redPlanValidationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => validerVersionPlan(db, auth, id, corps));
  });

  app.post("/redressement/dossiers/:id/leviers/simulation", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const corps = redLevierSimulationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      simulerLevier(db, (await exigerDossierRedVisible(db, auth, id)).dossier, corps),
    );
  });
};
