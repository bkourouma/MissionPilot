import type { FastifyPluginAsync } from "fastify";
import {
  feuilleDeRouteQuerySchema,
  planComparaisonQuerySchema,
  planCreationSchema,
  planElementCreationSchema,
  planElementParamsSchema,
  planElementVersionSchema,
  planHistoriqueQuerySchema,
  planListeQuerySchema,
  planModeleCreationSchema,
  planModeleListeQuerySchema,
  planModeleParamsSchema,
  planModeleSimulationSchema,
  planNotationLienSchema,
  planPartageSchema,
  planRecalageSchema,
  planVersionQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { traduireErreurKpi } from "../kpi/erreurs.js";
import { lierNotation, lireLienNotation, listerNotationsPubliees } from "../plans/diagnostic.js";
import {
  ajouterVersion,
  creerElement,
  historiqueElement,
  validerElement,
} from "../plans/elements.js";
import { traduireErreurPlan } from "../plans/erreurs.js";
import { appliquerRecalage } from "../plans/feuille-de-route.js";
import { creerKpiObjectif, lireKpiObjectifs } from "../plans/kpi.js";
import {
  comparerVersions,
  creerVersionModele,
  listerVersionsModele,
  lireVersionModele,
  simulerModele,
  validerVersionModele,
} from "../plans/modele.js";
import { creerPlan, lirePlan, listerPlans, partagerPlan } from "../plans/plans.js";
import { donneesRapport, lireFeuilleDeRoute, lireRoi } from "../plans/rapport.js";

/*
 * Planification stratégique et modèle financier (service #3), sous /api.
 * Règles d'accès : plans/acces.ts (plan.lire, plan.ecrire, plan.valider,
 * portail.gerer pour le partage). Les chiffres du modèle viennent du moteur
 * (plans/modele.ts) ; aucun appel IA ici. Un plan d'un autre cabinet ou d'une
 * mission invisible répond 404.
 *
 * - POST /missions/:id/plans, GET /missions/:id/plans ; GET /plans/:id ;
 *   POST /plans/:id/partage ;
 * - POST /plans/:id/elements ; POST /plans/:id/elements/:elementId/versions ;
 *   POST /plans/:id/elements/:elementId/validation ;
 *   GET /plans/:id/elements/:elementId/historique ;
 * - GET /plans/:id/feuille-de-route (recalage du moteur, PLA-05) ;
 *   POST /plans/:id/feuille-de-route/recalage (plan.ecrire) ;
 *   GET /plans/:id/initiatives/roi ;
 * - GET /plans/:id/kpi (plan.lire ET kpi.lire) ;
 *   POST /plans/:id/objectifs/:elementId/kpi (plan.ecrire ET kpi.gerer, PLA-10) ;
 * - GET /plans/:id/diagnostic/notation, GET /plans/:id/diagnostic/notations-publiees
 *   (plan.lire ET notation.lire) ; PUT /plans/:id/diagnostic/notation
 *   (plan.ecrire ET notation.lire) ;
 * - POST /plans/:id/modeles/simulation (sans enregistrement), POST et GET
 *   /plans/:id/modeles, GET /plans/:id/modeles/comparaison,
 *   GET /plans/:id/modeles/:version, POST /plans/:id/modeles/:version/validation ;
 * - GET /plans/:id/rapport : données structurées pour un futur export.
 */
export const routesPlans: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurPlan(error);
  });

  /* ----- Plans ----- */

  app.post("/missions/:id/plans", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planCreationSchema.parse(request.body);
    const plan = await app.db.withTenant(auth.cabinetId, (db) => creerPlan(db, auth, id, corps));
    return reply.status(201).send(plan);
  });

  app.get("/missions/:id/plans", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = planListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerPlans(db, auth, id, q));
  });

  app.get("/plans/:id", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lirePlan(db, auth, id));
  });

  app.post("/plans/:id/partage", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { id } = paramsId.parse(request.params);
    const { partage_client } = planPartageSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => partagerPlan(db, auth, id, partage_client));
  });

  /* ----- Éléments et versions ----- */

  app.post("/plans/:id/elements", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planElementCreationSchema.parse(request.body);
    const element = await app.db.withTenant(auth.cabinetId, (db) =>
      creerElement(db, auth, id, corps),
    );
    return reply.status(201).send(element);
  });

  app.post("/plans/:id/elements/:elementId/versions", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    const corps = planElementVersionSchema.parse(request.body);
    const element = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterVersion(db, auth, id, elementId, corps),
    );
    return reply.status(201).send(element);
  });

  app.post("/plans/:id/elements/:elementId/validation", async (request) => {
    const auth = exiger(request, "plan.valider");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => validerElement(db, auth, id, elementId));
  });

  app.get("/plans/:id/elements/:elementId/historique", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    const q = planHistoriqueQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => historiqueElement(db, auth, id, elementId, q));
  });

  /* ----- Lectures dérivées ----- */

  app.get("/plans/:id/feuille-de-route", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { pas } = feuilleDeRouteQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireFeuilleDeRoute(db, auth, id, pas));
  });

  app.post("/plans/:id/feuille-de-route/recalage", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const { initiatives } = planRecalageSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => appliquerRecalage(db, auth, id, initiatives));
  });

  app.get("/plans/:id/initiatives/roi", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { version } = planVersionQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireRoi(db, auth, id, version));
  });

  app.get("/plans/:id/rapport", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { version } = planVersionQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => donneesRapport(db, auth, id, version));
  });

  /* ----- KPI issus des objectifs (PLA-10) ----- */

  app.get("/plans/:id/kpi", async (request) => {
    const auth = exiger(request, "plan.lire");
    exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireKpiObjectifs(db, auth, id));
  });

  app.post("/plans/:id/objectifs/:elementId/kpi", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    exiger(request, "kpi.gerer");
    const { id, elementId } = planElementParamsSchema.parse(request.params);
    const objectif = await app.db
      .withTenant(auth.cabinetId, (db) => creerKpiObjectif(db, auth, id, elementId, request.body))
      .catch((e: unknown) => {
        throw traduireErreurKpi(e);
      });
    return reply.status(201).send(objectif);
  });

  /* ----- Diagnostic : notation publiée liée ----- */

  app.get("/plans/:id/diagnostic/notation", async (request) => {
    const auth = exiger(request, "plan.lire");
    exiger(request, "notation.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireLienNotation(db, auth, id));
  });

  app.get("/plans/:id/diagnostic/notations-publiees", async (request) => {
    const auth = exiger(request, "plan.lire");
    exiger(request, "notation.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => listerNotationsPubliees(db, auth, id));
  });

  app.put("/plans/:id/diagnostic/notation", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    exiger(request, "notation.lire");
    const { id } = paramsId.parse(request.params);
    const { notation_version_id } = planNotationLienSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      lierNotation(db, auth, id, notation_version_id),
    );
  });

  /* ----- Modèle financier ----- */

  app.post("/plans/:id/modeles/simulation", async (request) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planModeleSimulationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => simulerModele(db, auth, id, corps));
  });

  app.post("/plans/:id/modeles", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planModeleCreationSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, (db) =>
      creerVersionModele(db, auth, id, corps),
    );
    return reply.status(201).send(version);
  });

  app.get("/plans/:id/modeles", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = planModeleListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerVersionsModele(db, auth, id, q));
  });

  app.get("/plans/:id/modeles/comparaison", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { de, a } = planComparaisonQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => comparerVersions(db, auth, id, de, a));
  });

  app.get("/plans/:id/modeles/:version", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, version } = planModeleParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireVersionModele(db, auth, id, version));
  });

  app.post("/plans/:id/modeles/:version/validation", async (request) => {
    const auth = exiger(request, "plan.valider");
    const { id, version } = planModeleParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => validerVersionModele(db, auth, id, version));
  });
};
