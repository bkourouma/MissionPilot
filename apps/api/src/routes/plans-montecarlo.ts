import type { FastifyPluginAsync } from "fastify";
import {
  planMonteCarloDefautsQuerySchema,
  planMonteCarloListeQuerySchema,
  planMonteCarloParamsSchema,
  planMonteCarloSimulationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { traduireErreurPlan } from "../plans/erreurs.js";
import {
  defautsMonteCarlo,
  lancerSimulation,
  lireSimulationPlan,
  listerSimulations,
  rejouerSimulation,
} from "../plans/montecarlo.js";
import { traduireErreurMonteCarlo } from "../plans/montecarlo-erreurs.js";

/*
 * Simulation de Monte-Carlo du plan financier (PLA-16), monté par
 * routes/plans.ts sous /api. Un plan d'un autre cabinet ou d'une mission
 * invisible répond 404 ; rien n'est ouvert au portail client (aucune ligne de
 * la liste blanche, politique `portail_interdit`). États financiers du CLIENT :
 * réservés comme le reste du plan (« plan.lire »), jamais le gestionnaire.
 *
 * - POST /plans/:id/montecarlo/simulations (« plan.ecrire ») : lance et
 *   enregistre (graine absente = tirée par le serveur et renvoyée) ; au plus
 *   30 par utilisateur sur 10 minutes (429 TROP_DE_SIMULATIONS) ;
 * - GET /plans/:id/montecarlo/simulations, GET .../simulations/:simId
 *   (« plan.lire ») ;
 * - POST /plans/:id/montecarlo/simulations/:simId/rejeu (« plan.lire ») :
 *   relance avec la graine et les lois enregistrées, n'écrit rien ;
 * - GET /plans/:id/montecarlo/defauts?version= (« plan.lire ») : lois de
 *   départ, valeurs provisoires modifiables.
 * Les erreurs du moteur (400 MONTE_CARLO_INVALIDE) et des déclencheurs
 * (MQL10 à MQL14) sont traduites ici, puis par `traduireErreurPlan`.
 */
export const routesPlansMonteCarlo: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurPlan(traduireErreurMonteCarlo(error));
  });

  app.post("/plans/:id/montecarlo/simulations", async (request, reply) => {
    const auth = exiger(request, "plan.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = planMonteCarloSimulationSchema.parse(request.body);
    const simulation = await app.db.withTenant(auth.cabinetId, (db) =>
      lancerSimulation(db, auth, id, corps),
    );
    return reply.status(201).send(simulation);
  });

  app.get("/plans/:id/montecarlo/simulations", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const q = planMonteCarloListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerSimulations(db, auth, id, q));
  });

  app.get("/plans/:id/montecarlo/simulations/:simId", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, simId } = planMonteCarloParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireSimulationPlan(db, auth, id, simId));
  });

  app.post("/plans/:id/montecarlo/simulations/:simId/rejeu", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id, simId } = planMonteCarloParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => rejouerSimulation(db, auth, id, simId));
  });

  app.get("/plans/:id/montecarlo/defauts", async (request) => {
    const auth = exiger(request, "plan.lire");
    const { id } = paramsId.parse(request.params);
    const { version } = planMonteCarloDefautsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => defautsMonteCarlo(db, auth, id, version));
  });
};
