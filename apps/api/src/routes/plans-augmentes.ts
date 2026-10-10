import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  bibliothequeContexteQuerySchema,
  bibliothequeListeQuerySchema,
  initiativeTypeCreationSchema,
  initiativeTypeObservationSchema,
  initiativeTypeVersionSchema,
  planArbitrageSchema,
  planArbitragesListeQuerySchema,
  planBancabiliteQuerySchema,
  planContraintesPortefeuilleSchema,
  planElementParamsSchema,
  planEvaluationPortefeuilleSchema,
  planInitiativeDepuisBibliothequeSchema,
  planNoeudCascadeCreationSchema,
  planNoeudCascadeParamsSchema,
  planNoeudCascadeVersionSchema,
  planPorteurSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { lireBancabilite } from "../plans/bancabilite.js";
import {
  ajouterObservation,
  ajouterVersionInitiativeType,
  contexteDuPlan,
  creerInitiativeDepuisBibliotheque,
  creerInitiativeType,
  lireInitiativeType,
  listerBibliotheque,
} from "../plans/bibliotheque.js";
import { ajouterVersionNoeud, creerNoeud, designerPorteur, lireCascade } from "../plans/cascade.js";
import {
  arbitrerPortefeuille,
  evaluerInitiative,
  lirePortefeuille,
  listerArbitrages,
  proposerPortefeuille,
} from "../plans/portefeuille.js";

/** Contexte d'efficacité reçu en requête (critères absents : null). */
const contexte = (q: { secteur?: string; taille?: string; pays?: string }) => ({
  secteur: q.secteur ?? null,
  taille: q.taille ?? null,
  pays: q.pays ?? null,
});

/*
 * Plan stratégique augmenté (PRD complémentaire §11.3), monté par
 * routes/plans.ts sous /api (mêmes traductions d'erreurs : plans/erreurs.ts).
 * Un plan d'un autre cabinet ou d'une mission invisible répond 404 ; rien
 * n'est ouvert au portail client.
 *
 * Cascade (PLA-12, plans/cascade.ts) :
 * - GET /plans/:id/cascade (« plan.lire ») : graphe, trous et couverture du moteur ;
 * - PUT /plans/:id/elements/:elementId/porteur (« plan.ecrire ») : vision, axe, objectif ;
 * - POST /plans/:id/cascade/noeuds, POST /plans/:id/cascade/noeuds/:noeudId/versions
 *   (« plan.ecrire ») : projets et jalons.
 * Bibliothèque d'initiatives (PLA-13, plans/bibliotheque.ts) :
 * - GET /bibliotheque-initiatives, GET /bibliotheque-initiatives/:id (« plan.lire ») ;
 * - POST /bibliotheque-initiatives, POST /bibliotheque-initiatives/:id/versions,
 *   POST /bibliotheque-initiatives/:id/observations (« standard.gerer ») ;
 * - GET /plans/:id/bibliotheque (« plan.lire » ; efficacité dans le contexte du client) ;
 * - POST /plans/:id/initiatives/depuis-bibliotheque (« plan.ecrire »).
 * Portefeuille (PLA-14, plans/portefeuille.ts) :
 * - GET /plans/:id/portefeuille, POST /plans/:id/portefeuille/proposition (sans
 *   écriture métier ; au plus 30 par utilisateur sur 10 minutes, 429 TROP_DE_PROPOSITIONS),
 *   GET /plans/:id/portefeuille/arbitrages (« plan.lire ») ;
 * - PUT /plans/:id/portefeuille/initiatives/:elementId (« plan.ecrire ») ;
 * - POST /plans/:id/portefeuille/arbitrages (« plan.valider », responsable de la mission).
 * Bancabilité (PLA-17, plans/bancabilite.ts) : GET /plans/:id/bancabilite
 * (« plan.lire ») ; le dossier bancaire se génère par POST
 * /plans/:id/dossier-bancaire (routes/rapports.ts).
 */
export const routesPlansAugmentes: FastifyPluginAsync = async (app) => {
  /* ----- Cascade (PLA-12) ----- */

  app.get("/plans/:id/cascade", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const voirKpi = aPermission(auth.roles, "kpi.lire");
    return app.db.withTenant(auth.cabinetId, (db) => lireCascade(db, auth, id, voirKpi));
  });

  app.put("/plans/:id/elements/:elementId/porteur", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    const { porteur_id } = planPorteurSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      designerPorteur(db, auth, id, elementId, porteur_id),
    );
  });

  app.post("/plans/:id/cascade/noeuds", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planNoeudCascadeCreationSchema.parse(request.body);
    const noeud = await app.db.withTenant(auth.cabinetId, (db) => creerNoeud(db, auth, id, corps));
    return reply.status(201).send(noeud);
  });

  app.post("/plans/:id/cascade/noeuds/:noeudId/versions", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, noeudId } = planNoeudCascadeParamsSchema.parse(request.params);
    const corps = planNoeudCascadeVersionSchema.parse(request.body);
    const noeud = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterVersionNoeud(db, auth, id, noeudId, corps),
    );
    return reply.status(201).send(noeud);
  });

  /* ----- Bibliothèque d'initiatives (PLA-13) ----- */

  app.get("/bibliotheque-initiatives", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { limite, curseur, ...q } = bibliothequeListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerBibliotheque(db, { limite, curseur }, contexte(q)),
    );
  });

  app.get("/bibliotheque-initiatives/:id", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = bibliothequeContexteQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireInitiativeType(db, id, contexte(q)));
  });

  app.post("/bibliotheque-initiatives", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = initiativeTypeCreationSchema.parse(request.body);
    const t = await app.db.withTenant(auth.cabinetId, (db) => creerInitiativeType(db, auth, corps));
    return reply.status(201).send(t);
  });

  app.post("/bibliotheque-initiatives/:id/versions", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = initiativeTypeVersionSchema.parse(request.body);
    const t = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterVersionInitiativeType(db, auth, id, corps),
    );
    return reply.status(201).send(t);
  });

  app.post("/bibliotheque-initiatives/:id/observations", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = initiativeTypeObservationSchema.parse(request.body);
    const o = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterObservation(db, auth, id, corps),
    );
    return reply.status(201).send(o);
  });

  app.get("/plans/:id/bibliotheque", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { limite, curseur } = bibliothequeListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerBibliotheque(db, { limite, curseur }, await contexteDuPlan(db, auth, id)),
    );
  });

  app.post("/plans/:id/initiatives/depuis-bibliotheque", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planInitiativeDepuisBibliothequeSchema.parse(request.body);
    const element = await app.db.withTenant(auth.cabinetId, (db) =>
      creerInitiativeDepuisBibliotheque(db, auth, id, corps),
    );
    return reply.status(201).send(element);
  });

  /* ----- Portefeuille (PLA-14) ----- */

  app.get("/plans/:id/portefeuille", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lirePortefeuille(db, auth, id));
  });

  app.put("/plans/:id/portefeuille/initiatives/:elementId", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    const corps = planEvaluationPortefeuilleSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      evaluerInitiative(db, auth, id, elementId, corps),
    );
  });

  app.post("/plans/:id/portefeuille/proposition", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const contraintes = planContraintesPortefeuilleSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      proposerPortefeuille(db, auth, id, contraintes),
    );
  });

  app.post("/plans/:id/portefeuille/arbitrages", async (request, reply) => {
    const auth = exiger(request, "plan.valider");
    const { id } = paramsId.parse(request.params);
    const corps = planArbitrageSchema.parse(request.body);
    const a = await app.db.withTenant(auth.cabinetId, (db) =>
      arbitrerPortefeuille(db, auth, id, corps),
    );
    return reply.status(201).send(a);
  });

  app.get("/plans/:id/portefeuille/arbitrages", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = planArbitragesListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerArbitrages(db, auth, id, q));
  });

  /* ----- Bancabilité (PLA-17) ----- */

  app.get("/plans/:id/bancabilite", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { version } = planBancabiliteQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireBancabilite(db, auth, id, version));
  });
};
