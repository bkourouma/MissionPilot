import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../errors.js";
import { traduireErreurMoteur } from "../missions/moteur.js";
import { routesAbsences } from "./absences.js";
import { routesAffectations } from "./affectations.js";
import { routesFeriesDefaut } from "./feries-defaut.js";
import { routesNotifications } from "./notifications.js";
import { routesPlanDeCharge } from "./plan-de-charge.js";
import { routesReplanification } from "./replanification.js";

/** Code SQLSTATE du déclencheur d'immuabilité des absences (migration 0020). */
const SQL_ABSENCE_FIGEE = "MPF03";

function traduire(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === SQL_ABSENCE_FIGEE) {
    return new AppError(409, "ABSENCE_FIGEE", "Cette absence ne peut plus être modifiée.");
  }
  return traduireErreurMoteur(error);
}

/**
 * Planification (V1), montée sous /api : affectations (PLN-04, PLN-08),
 * congés et absences (PLN-07), plan de charge (PLN-06), « Mon planning »
 * (PLN-10), re-planification (PLN-09), jours fériés par défaut (SOC-04) et
 * notifications in-app (SOC-08).
 */
export const routesPlanification: FastifyPluginAsync = async (app) => {
  // Erreurs des moteurs (cycle de dépendances…) et des déclencheurs → 409 ;
  // le reste remonte au gestionnaire d'erreurs de l'application.
  app.setErrorHandler(async (error) => {
    throw traduire(error);
  });
  await app.register(routesAffectations);
  await app.register(routesAbsences);
  await app.register(routesPlanDeCharge);
  await app.register(routesReplanification);
  await app.register(routesFeriesDefaut);
  await app.register(routesNotifications);
};
