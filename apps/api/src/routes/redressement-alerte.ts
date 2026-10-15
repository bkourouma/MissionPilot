import type { FastifyPluginAsync } from "fastify";
import {
  redHistoriqueQuerySchema,
  redScoreCreationSchema,
  redSeuilsCreationSchema,
  redSeuilsPublicationSchema,
  redSeuilsQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import { creerScore, listerScores } from "../redressement/alerte.js";
import { creerSeuils, lireSeuils, publierSeuils } from "../redressement/seuils.js";

/*
 * Seuils d'alerte par secteur et scores d'alerte précoce (RED-10, routes 13 à 17), plugin de
 * routes/redressement.ts (qui traduit les erreurs du module). Droits : `redressement.lire` (lecture),
 * `redressement.parametrer` (rédiger et publier les seuils : associé et expert métier),
 * `redressement.ecrire` (calculer un score). Le score est INDICATIF : il ne qualifie aucune
 * situation juridique.
 */
export const routesRedressementAlerte: FastifyPluginAsync = async (app) => {
  app.get("/redressement/seuils", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const q = redSeuilsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireSeuils(db, auth, q.secteur));
  });

  app.post("/redressement/seuils", async (request, reply) => {
    const auth = exiger(request, "redressement.parametrer");
    const corps = redSeuilsCreationSchema.parse(request.body);
    const v = await app.db.withTenant(auth.cabinetId, (db) => creerSeuils(db, auth, corps));
    reply.status(201);
    return v;
  });

  app.post("/redressement/seuils/:id/publication", async (request) => {
    const auth = exiger(request, "redressement.parametrer");
    const { id } = paramsId.parse(request.params);
    redSeuilsPublicationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => publierSeuils(db, auth, id));
  });

  app.get("/redressement/dossiers/:id/scores", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const q = redHistoriqueQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerScores(db, (await exigerDossierRedVisible(db, auth, id)).dossier, q),
    );
  });

  app.post("/redressement/dossiers/:id/scores", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redScoreCreationSchema.parse(request.body ?? {});
    const s = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerScore(db, auth, (await exigerDossierRedEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return s;
  });
};
