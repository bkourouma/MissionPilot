import type { FastifyPluginAsync } from "fastify";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { semerCatalogueConseil } from "../catalogue/catalogue-conseil.js";
import { routesAudit } from "./audit.js";
import { routesCabinet } from "./cabinet.js";
import { routesCatalogue } from "./catalogue.js";
import { routesClients } from "./clients.js";
import { routesCollaborateurs } from "./collaborateurs.js";
import { routesGrades } from "./grades.js";
import { routesUtilisateurs } from "./utilisateurs.js";

/** Référentiels et administration du cabinet (V1), montés sous /api. */
export const routesReferentiels: FastifyPluginAsync = async (app) => {
  await app.register(routesUtilisateurs);
  await app.register(routesCabinet);
  await app.register(routesClients);
  await app.register(routesGrades);
  await app.register(routesCollaborateurs);
  await app.register(routesCatalogue);
  await app.register(routesAudit);

  /** Ajoute au cabinet les grades et le catalogue conseil de départ (idempotent). */
  app.post("/catalogue/semer-conseil", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const ajoutes = await semerCatalogueConseil(db, auth.cabinetId);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "semis_catalogue_conseil",
        entite: "catalogue",
        details: ajoutes,
      });
      return ajoutes;
    });
  });
};
