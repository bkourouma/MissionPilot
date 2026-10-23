import type { FastifyPluginAsync } from "fastify";
import {
  veilleAvisSaisieSchema,
  veilleCollecteSchema,
  veilleImportSchema,
  veilleMotifOptionnelSchema,
  veilleMotifSchema,
  veilleResultatsQuerySchema,
  veilleSourceActivationSchema,
} from "@missionpilot/shared";
import { traduireErreurVeille } from "../appels-offres/veille-erreurs.js";
import {
  activerSource,
  collecter,
  creerFicheDepuisResultat,
  decider,
  detailResultat,
  importerTexte,
  listerResultats,
  listerSources,
  resumeVeille,
  saisirAvis,
} from "../appels-offres/veille.js";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { z } from "zod";

/**
 * Veille multi-sources des appels d'offres (AO-01, PRD complémentaire §9), montée sous /api.
 *
 * - Droits : `ao.lire` (lecture), `ao.gerer` (activer une source, collecter, importer, saisir,
 *   retenir, écarter, réexaminer, créer la fiche). Aucune route n'est ouverte au portail client
 *   (liste blanche fermée par défaut, tables `portail_interdit`).
 * - Aucun appel externe : sources SIMULÉES, collecte déclenchée à la main, URL jamais visitées.
 * - Scores et raisons : packages/engines/src/appels-offres/veille.ts. Chaque écriture est
 *   journalisée dans sa transaction.
 * - Les chemins /appels-offres/veille/… sont statiques : Fastify les préfère à
 *   /appels-offres/:id (vérifié par test).
 */

const paramsCode = z.object({ code: z.string().regex(/^[a-z0-9_]{1,40}$/) }).strict();
/** Corps d'import : 1 Mo de texte, mais marge pour l'échappement JSON. */
const LIMITE_CORPS_IMPORT = 4_194_304;

export const routesVeille: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurVeille(error);
  });

  app.get("/appels-offres/veille", async (request) => {
    const auth = exiger(request, "ao.lire");
    return app.db.withTenant(auth.cabinetId, (db) => resumeVeille(db));
  });

  app.get("/appels-offres/veille/sources", async (request) => {
    const auth = exiger(request, "ao.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => ({ elements: await listerSources(db) }));
  });

  app.put("/appels-offres/veille/sources/:code", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { code } = paramsCode.parse(request.params);
    const { active } = veilleSourceActivationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => activerSource(db, auth, code, active));
  });

  app.post("/appels-offres/veille/collecte", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = veilleCollecteSchema.parse(request.body ?? {});
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      collecter(db, auth, corps.sources, new Date()),
    );
    reply.status(201);
    return r;
  });

  app.post(
    "/appels-offres/veille/import",
    { bodyLimit: LIMITE_CORPS_IMPORT },
    async (request, reply) => {
      const auth = exiger(request, "ao.gerer");
      const corps = veilleImportSchema.parse(request.body);
      const r = await app.db.withTenant(auth.cabinetId, (db) =>
        importerTexte(
          db,
          auth,
          corps.texte,
          corps.format === "auto" ? undefined : corps.format,
          new Date(),
        ),
      );
      reply.status(201);
      return r;
    },
  );

  app.post("/appels-offres/veille/avis", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = veilleAvisSaisieSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      saisirAvis(db, auth, corps, new Date()),
    );
    reply.status(201);
    return { id: r.id, nouveau: r.bilan.nouveaux === 1 };
  });

  app.get("/appels-offres/veille/resultats", async (request) => {
    const auth = exiger(request, "ao.lire");
    const q = veilleResultatsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerResultats(db, q));
  });

  app.get("/appels-offres/veille/resultats/:id", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailResultat(db, id));
  });

  app.post("/appels-offres/veille/resultats/:id/retenir", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = veilleMotifOptionnelSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) =>
      decider(db, auth, id, "retenir", corps.motif ?? null),
    );
  });

  app.post("/appels-offres/veille/resultats/:id/ecarter", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = veilleMotifSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => decider(db, auth, id, "ecarter", corps.motif));
  });

  app.post("/appels-offres/veille/resultats/:id/reexaminer", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = veilleMotifSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      decider(db, auth, id, "reexaminer", corps.motif),
    );
  });

  app.post("/appels-offres/veille/resultats/:id/fiche", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      creerFicheDepuisResultat(db, auth, id),
    );
    reply.status(201);
    return r;
  });
};
