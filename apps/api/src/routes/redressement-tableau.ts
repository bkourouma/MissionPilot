import type { FastifyPluginAsync } from "fastify";
import { redTableauPortefeuilleQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedVisible } from "../redressement/acces.js";
import { listerTableauPortefeuille, vueTableauDossier } from "../redressement/tableau.js";

/*
 * Tableau de bord du redressement (RED-15, version INTERNE), plugin de routes/redressement.ts (qui
 * traduit les erreurs du module). Droit `redressement.lire` + mission visible (404 sinon). Lecture
 * seule : rien n'est écrit ni journalisé. Aucune route du portail : le partage externe (conseil
 * d'administration, banques) n'est pas ouvert. Réponses `cache-control: private`.
 */
export const routesRedressementTableau: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/tableau-de-bord", async (request, reply) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    reply.header("cache-control", "private");
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueTableauDossier(db, auth, await exigerDossierRedVisible(db, auth, id)),
    );
  });

  app.get("/redressement/tableau-de-bord", async (request, reply) => {
    const auth = exiger(request, "redressement.lire");
    const q = redTableauPortefeuilleQuerySchema.parse(request.query);
    reply.header("cache-control", "private");
    return app.db.withTenant(auth.cabinetId, (db) => listerTableauPortefeuille(db, auth, q));
  });
};
