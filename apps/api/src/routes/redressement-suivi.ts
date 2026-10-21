import type { FastifyPluginAsync } from "fastify";
import {
  redSuiviEvenementCreationSchema,
  redSuiviJalonParamsSchema,
  redSuiviPlanCreationSchema,
  redSuiviReleveCreationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedVisible } from "../redressement/acces.js";
import {
  creerPlanSuivi,
  enregistrerEvenement,
  enregistrerReleve,
  lireSuivi,
} from "../redressement/suivi.js";
import { exigerDossierSuiviEcriture } from "../redressement/suivi-acces.js";

/*
 * Suivi post-mission (RED-09, lot 2), plugin de routes/redressement.ts. INTERNE au cabinet : le
 * portail n'a aucune de ces routes (liste blanche inchangée, tables en `portail_interdit`), aucun
 * envoi externe, aucun job. Droits : `redressement.lire` (lecture) et `redressement.ecrire` +
 * équipe de la mission (`suivi-acces.ts`). Le suivi suit la CLÔTURE du dossier : les écritures
 * exigent un dossier clos (409 RED_DOSSIER_NON_CLOS) et restent possibles mission clôturée. Les
 * alertes sont calculées par le moteur à chaque lecture, à la date du jour du serveur.
 */
export const routesRedressementSuivi: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/suivi", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireSuivi(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/suivi", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redSuiviPlanCreationSchema.parse(request.body ?? {});
    const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerPlanSuivi(db, auth, (await exigerDossierSuiviEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return vue;
  });

  app.post("/redressement/dossiers/:id/suivi/releves", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redSuiviReleveCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
      enregistrerReleve(db, auth, (await exigerDossierSuiviEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return vue;
  });

  app.post(
    "/redressement/dossiers/:id/suivi/jalons/:jalonId/evenements",
    async (request, reply) => {
      const auth = exiger(request, "redressement.ecrire");
      const { id, jalonId } = redSuiviJalonParamsSchema.parse(request.params);
      const corps = redSuiviEvenementCreationSchema.parse(request.body);
      const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
        enregistrerEvenement(
          db,
          auth,
          (await exigerDossierSuiviEcriture(db, auth, id)).dossier,
          jalonId,
          corps,
        ),
      );
      reply.status(201);
      return vue;
    },
  );
};
