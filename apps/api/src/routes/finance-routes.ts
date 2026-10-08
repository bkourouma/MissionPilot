import type { FastifyPluginAsync } from "fastify";
import { traduireErreurFinanceV1 } from "../finance/erreurs.js";
import { routesBilans } from "./bilans.js";
import { routesEncaissements } from "./encaissements.js";
import { routesExportComptable } from "./export-comptable.js";
import { routesFinanceAnalyses } from "./finance-analyses.js";
import { routesIndicateurs } from "./indicateurs.js";
import { routesRelances } from "./relances.js";

/**
 * Fin de la finance V1, montée sous /api : encaissements, imputations et
 * contre-passations, relances (FIN-09), balance âgée, encours (FIN-11),
 * rentabilité (FIN-12), export comptable (FIN-13), bilan de clôture et
 * indicateurs de pilotage du cabinet.
 */
export const routesFinance: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurFinanceV1(error);
  });
  await app.register(routesEncaissements);
  await app.register(routesRelances);
  await app.register(routesFinanceAnalyses);
  await app.register(routesBilans);
  await app.register(routesIndicateurs);
  await app.register(routesExportComptable);
};
