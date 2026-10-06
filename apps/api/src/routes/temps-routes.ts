import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../errors.js";
import { traduireErreurMoteur } from "../missions/moteur.js";
import { routesDisciplineTemps } from "./discipline-temps.js";
import { routesFeuillesTemps } from "./feuilles-temps.js";
import { routesImportTemps } from "./import-temps.js";
import { routesPeriodesTemps } from "./periodes-temps.js";
import { routesSuiviTemps } from "./suivi-temps.js";
import { routesTempsParametres } from "./temps-parametres.js";

/** Codes SQLSTATE des déclencheurs des temps (migration 0030). */
const ERREURS_SQL: Record<string, () => AppError> = {
  MPT01: () =>
    new AppError(
      409,
      "FEUILLE_FIGEE",
      "Feuille de temps soumise ou validée : modification refusée.",
    ),
  MPT02: () => new AppError(400, "REQUETE_INVALIDE", "Date hors de la semaine de la feuille."),
  MPT03: () =>
    new AppError(
      409,
      "PERIODE_CLOTUREE",
      "Période de temps clôturée : passer par une demande de correction.",
    ),
  MPT04: () => new AppError(409, "CORRECTION_FIGEE", "Cette correction a déjà été décidée."),
};

function traduire(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const erreur = ERREURS_SQL[code];
  return erreur ? erreur() : traduireErreurMoteur(error);
}

/**
 * Temps (V1), montés sous /api : feuilles de temps et activités internes
 * (TPS-01 à TPS-03), reste à faire et suivi (TPS-05 à TPS-08), clôture
 * mensuelle et corrections (TPS-09), import de l'historique (TPS-10),
 * discipline de saisie (TPS-04).
 */
export const routesTemps: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduire(error);
  });
  await app.register(routesTempsParametres);
  await app.register(routesFeuillesTemps);
  await app.register(routesSuiviTemps);
  await app.register(routesPeriodesTemps);
  await app.register(routesImportTemps);
  await app.register(routesDisciplineTemps);
};
