import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  analyseDdSchema,
  modeleSecteurCreationSchema,
  modeleSecteurVersionSchema,
  modelesSecteurQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible } from "../due-diligence/acces.js";
import { traduireErreurModeles } from "../due-diligence/erreurs-modeles.js";
import { curseurNumero, journalDd } from "../due-diligence/journal.js";
import {
  corrigerModele,
  creerModele,
  lireModele,
  listerModeles,
  modelesDuDossier,
  versionsDuModele,
  vueModele,
} from "../due-diligence/modeles.js";
import { paginer, paramsId } from "../http/outils.js";

/*
 * Modèles d'analyse par secteur (DD-07) : lecture `dd.lire`, écriture `dd.referentiel.gerer`
 * (cabinet entier). Bibliothèque vide au départ. Fermées au portail (`LISTE_BLANCHE_PORTAIL`
 * inchangée). Erreurs traduites par ce plugin (repli sur la traduction commune de la due diligence).
 */

const analyseQuerySchema = z.object({ analyse: analyseDdSchema.optional() }).strict();

export const routesDueDiligenceModeles: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurModeles(error);
  });

  app.get("/dd/modeles-secteur", async (request) => {
    const auth = exiger(request, "dd.lire");
    const q = modelesSecteurQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const page = paginer(await listerModeles(db, q, apres), q.limite);
      return { elements: page.elements.map(vueModele), curseur_suivant: page.curseur_suivant };
    });
  });

  app.post("/dd/modeles-secteur", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const c = modeleSecteurCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const m = await creerModele(db, auth, c);
      await journalDd(db, auth, "dd_modele_secteur_cree", "dd_modele_secteur", m.id, {
        secteur_code: c.secteur_code,
        analyse: c.analyse,
        points: c.points.length,
      });
      return m;
    });
    reply.status(201);
    return cree;
  });

  app.get("/dd/modeles-secteur/:id", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => vueModele(await lireModele(db, id)));
  });

  app.post("/dd/modeles-secteur/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const { id } = paramsId.parse(request.params);
    const c = modeleSecteurVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const v = await corrigerModele(db, auth, id, c);
      await journalDd(db, auth, "dd_modele_secteur_modifie", "dd_modele_secteur", id, {
        version: v,
        actif: c.actif,
        points: c.points.length,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.get("/dd/modeles-secteur/:id/versions", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => ({
      elements: await versionsDuModele(db, id),
    }));
  });

  /** Modèles actifs du secteur du cadrage courant du dossier (liste vide sans modèle). */
  app.get("/dd/dossiers/:id/modeles-secteur", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const { analyse } = analyseQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return modelesDuDossier(db, id, analyse ?? null);
    });
  });
};
