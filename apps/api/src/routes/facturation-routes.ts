import type { FastifyPluginAsync } from "fastify";
import { traduireErreurFacturation } from "../facturation/outils.js";
import { routesDebours } from "./debours.js";
import { routesEcheancier } from "./echeancier.js";
import { routesFactures } from "./factures.js";
import { routesParametresFacturation } from "./parametres-facturation.js";
import { routesTauxClients } from "./taux-clients.js";

/**
 * Facturation de la V1, montée sous /api : paramètres de facturation et
 * taux négociés (FIN-02, FIN-07), débours (FIN-05), échéancier (FIN-06,
 * MIS-10), factures et avoirs (FIN-07, FIN-15). Les encaissements, relances,
 * balance âgée, rentabilité et export comptable se brancheront ici.
 */
export const routesFacturation: FastifyPluginAsync = async (app) => {
  // Erreurs des moteurs et des déclencheurs de facturation → 409/400 ; le
  // reste remonte au gestionnaire d'erreurs de l'application.
  app.setErrorHandler(async (error) => {
    throw traduireErreurFacturation(error);
  });
  await app.register(routesParametresFacturation);
  await app.register(routesTauxClients);
  await app.register(routesDebours);
  await app.register(routesEcheancier);
  await app.register(routesFactures);
};
