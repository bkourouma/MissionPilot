import type { FastifyPluginAsync } from "fastify";
import { traduireErreurMoteur } from "../missions/moteur.js";
import { routesBudget } from "./budget.js";
import { routesDecoupage } from "./decoupage.js";
import { routesDocuments } from "./documents.js";
import { routesMissions } from "./missions.js";
import { routesOpportunites } from "./opportunites.js";
import { routesPropositions } from "./propositions.js";

/**
 * Cycle commercial et structure des missions (V1), montés sous /api :
 * pipeline (MIS-04), propositions (MIS-05), missions (MIS-07 à MIS-12),
 * découpage et planning (PLN-01 à PLN-03), budget (FIN-03, FIN-04, FIN-15),
 * documents (SOC-05).
 */
export const routesCycleMission: FastifyPluginAsync = async (app) => {
  // Erreurs des moteurs et des déclencheurs d'immuabilité → 409/400 ; le reste
  // remonte au gestionnaire d'erreurs de l'application.
  app.setErrorHandler(async (error) => {
    throw traduireErreurMoteur(error);
  });
  await app.register(routesOpportunites);
  await app.register(routesPropositions);
  await app.register(routesMissions);
  await app.register(routesDecoupage);
  await app.register(routesBudget);
  await app.register(routesDocuments);
};
