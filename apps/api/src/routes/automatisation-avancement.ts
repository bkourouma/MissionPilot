import type { FastifyPluginAsync } from "fastify";
import {
  avancementGenerationSchema,
  avancementListeQuerySchema,
  avancementModificationSchema,
  avancementParametresModificationSchema,
  avancementVersionSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import {
  exigerMissionPourAvancement,
  exigerRapport,
  genererRapportManuel,
  listerRapports,
  lireParametresAvancement,
  lundiDe,
  modifierParametresAvancement,
  modifierRapport,
  regenererRapport,
  suggererCommentaireRapport,
  traduireErreurAvancement,
  validerRapport,
  vueLigneRapport,
  vueRapport,
} from "../automatisation/avancement-service.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { z } from "zod";

/*
 * Rapport d'avancement hebdomadaire au client (AUT-10), côté cabinet. Le brouillon est produit par la
 * tâche « avancement_hebdo » (ou à la demande) depuis le moteur ; le chef de mission relit, complète
 * l'introduction et le commentaire (jamais les chiffres), puis valide. Seul un rapport validé est
 * visible du client (routes/portail-avancement.ts). Lecture : `avancement.lire` + mission visible ;
 * modifier, régénérer, valider, générer : `avancement.valider` ET associé, directeur ou chef de la
 * mission. Paramètre du cabinet : `automatisation.gerer`. Aucun e-mail n'est jamais émis.
 */
const paramsMission = z.object({ id: z.string().uuid() });

export const routesAutomatisationAvancement: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/avancement", async (request) => {
    const auth = exiger(request, "avancement.lire");
    const { id } = paramsMission.parse(request.params);
    const q = avancementListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionPourAvancement(db, auth, id);
      const { lignes, suivant } = await listerRapports(db, id, q.limite, q.avant);
      return { elements: lignes.map(vueLigneRapport), suivant };
    });
  });

  app.post("/missions/:id/avancement", async (request, reply) => {
    const auth = exiger(request, "avancement.valider");
    const { id } = paramsMission.parse(request.params);
    const c = avancementGenerationSchema.parse(request.body ?? {});
    const maintenant = new Date();
    const r = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionPourAvancement(db, auth, id);
      let res;
      try {
        res = await genererRapportManuel(
          db,
          auth,
          mission,
          c.semaine ?? lundiDe(maintenant),
          maintenant,
        );
      } catch (e) {
        throw traduireErreurAvancement(e);
      }
      return { ...res, rapport: vueRapport(await exigerRapport(db, auth, res.id), auth) };
    });
    reply.status(r.cree ? 201 : 200);
    return r.rapport;
  });

  app.get("/avancement/parametres", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresAvancement(db));
  });

  app.put("/avancement/parametres", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const c = avancementParametresModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      modifierParametresAvancement(db, auth, c.actif),
    );
  });

  app.get("/avancement/:id", async (request) => {
    const auth = exiger(request, "avancement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueRapport(await exigerRapport(db, auth, id), auth),
    );
  });

  app.patch("/avancement/:id", async (request) => {
    const auth = exiger(request, "avancement.valider");
    const { id } = paramsId.parse(request.params);
    const c = avancementModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueRapport(await modifierRapport(db, auth, id, c), auth),
    );
  });

  app.post("/avancement/:id/regenerer", async (request) => {
    const auth = exiger(request, "avancement.valider");
    const { id } = paramsId.parse(request.params);
    const c = avancementVersionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueRapport(await regenererRapport(db, auth, id, c.version, new Date()), auth),
    );
  });

  app.post("/avancement/:id/valider", async (request) => {
    const auth = exiger(request, "avancement.valider");
    const { id } = paramsId.parse(request.params);
    const c = avancementVersionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueRapport(await validerRapport(db, auth, id, c.version), auth),
    );
  });

  /**
   * Suggestion de commentaire par l'IA, en BROUILLON IA à relire (jamais visible du client). Réponse :
   * le rapport et `suggestion: { obtenue, raison }` (raison non nulle quand l'IA n'a rien proposé).
   */
  app.post("/avancement/:id/suggerer-commentaire", async (request) => {
    const auth = exiger(request, "avancement.valider");
    const { id } = paramsId.parse(request.params);
    const c = avancementVersionSchema.parse(request.body);
    const r = await suggererCommentaireRapport(
      app.db,
      { database: app.db, ia: { config: app.config } },
      auth,
      id,
      c.version,
      new Date(),
    );
    await envoyerEmails(app.mailer, r.notifications, (m) => request.log.warn(m));
    return { ...vueRapport(r.rapport, auth), suggestion: r.suggestion };
  });
};
