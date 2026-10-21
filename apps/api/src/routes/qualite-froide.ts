import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  actionFroideCreationSchema,
  actionFroideModificationSchema,
  actionsFroidesQuerySchema,
  affectationRelecteurSchema,
  campagneFroideCreationSchema,
  campagneFroideListeQuerySchema,
  constatFroidCreationSchema,
  evaluationRevueFroideSchema,
  revueFroideTerminaisonSchema,
  aPermission,
} from "@missionpilot/shared";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";
import { traduireErreurQualite } from "../qualite/erreurs.js";
import { dossierRevue } from "../qualite/froide-dossier.js";
import {
  creerAction,
  detailAction,
  listerActions,
  modifierAction,
  planCampagne,
} from "../qualite/froide-plan.js";
import {
  affecterRelecteur,
  ajouterConstat,
  cloturerCampagne,
  detailRevue,
  evaluerCritere,
  mesRevues,
  relecteursEligibles,
  retirerConstat,
  terminerRevue,
} from "../qualite/froide-revue.js";
import {
  creerCampagne,
  detailCampagne,
  listerCampagnes,
  verifierCampagne,
} from "../qualite/froide-tirage.js";

/*
 * Revue à froid des missions clôturées par échantillonnage (QUA-05), montée sous /api, préfixe
 * /qualite/revue-froide. Droits : `qualite.froide.gerer` (associé) tire l'échantillon, affecte un
 * relecteur indépendant, clôt la campagne et pilote le plan d'amélioration ;
 * `qualite.froide.relire` (associé, directeur de mission, expert métier) tient la grille et les
 * constats des revues qui lui sont affectées. Une revue n'est lisible que de son relecteur affecté
 * et de qui gère la revue (sinon 404, jamais 403). Le score et la conclusion sortent du moteur ;
 * l'IA n'intervient jamais. Aucune route n'est ouverte au portail client (`LISTE_BLANCHE_PORTAIL`,
 * tables `portail_interdit`). Chaque écriture est journalisée dans la transaction de l'écriture.
 */

const paramsId = z.object({ id: z.string().uuid() }).strict();
const paramsConstat = z.object({ id: z.string().uuid(), constatId: z.string().uuid() }).strict();
const queryVide = z.object({}).strict();

/** Lecture d'une revue : gestionnaire de la revue à froid ou relecteur habilité (le détail filtre). */
function exigerLectureRevue(request: FastifyRequest) {
  const gere = request.auth ? aPermission(request.auth.roles, "qualite.froide.gerer") : false;
  return exiger(request, gere ? "qualite.froide.gerer" : "qualite.froide.relire");
}

function routesCampagnes(app: FastifyInstance) {
  app.post("/qualite/revue-froide/campagnes", async (request, reply) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const corps = campagneFroideCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      const id = await creerCampagne(db, auth, corps);
      return detailCampagne(db, id);
    });
    reply.status(201);
    return detail;
  });

  app.get("/qualite/revue-froide/campagnes", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const q = campagneFroideListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerCampagnes(db, q));
  });

  app.get("/qualite/revue-froide/campagnes/:id", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    queryVide.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => detailCampagne(db, id));
  });

  app.get("/qualite/revue-froide/campagnes/:id/verification", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => verifierCampagne(db, id));
  });

  app.post("/qualite/revue-froide/campagnes/:id/cloture", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => cloturerCampagne(db, auth, id));
  });
}

function routesRevues(app: FastifyInstance) {
  app.get("/qualite/revue-froide/mes-revues", async (request) => {
    const auth = exiger(request, "qualite.froide.relire");
    return app.db.withTenant(auth.cabinetId, (db) => mesRevues(db, auth));
  });

  app.get("/qualite/revue-froide/echantillons/:id", async (request) => {
    const auth = exigerLectureRevue(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailRevue(db, auth, id));
  });

  app.get("/qualite/revue-froide/echantillons/:id/dossier", async (request) => {
    const auth = exigerLectureRevue(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => dossierRevue(db, auth, id));
  });

  app.get("/qualite/revue-froide/echantillons/:id/relecteurs-eligibles", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => relecteursEligibles(db, id));
  });

  app.post("/qualite/revue-froide/echantillons/:id/affectation", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = affectationRelecteurSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      affecterRelecteur(db, auth, id, corps.relecteur_id),
    );
  });

  app.put("/qualite/revue-froide/echantillons/:id/evaluations", async (request) => {
    const auth = exiger(request, "qualite.froide.relire");
    const { id } = paramsId.parse(request.params);
    const corps = evaluationRevueFroideSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => evaluerCritere(db, auth, id, corps));
  });

  app.post("/qualite/revue-froide/echantillons/:id/constats", async (request, reply) => {
    const auth = exiger(request, "qualite.froide.relire");
    const { id } = paramsId.parse(request.params);
    const corps = constatFroidCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterConstat(db, auth, id, corps),
    );
    reply.status(201);
    return detail;
  });

  app.delete(
    "/qualite/revue-froide/echantillons/:id/constats/:constatId",
    async (request, reply) => {
      const auth = exiger(request, "qualite.froide.relire");
      const { id, constatId } = paramsConstat.parse(request.params);
      await app.db.withTenant(auth.cabinetId, (db) => retirerConstat(db, auth, id, constatId));
      return reply.status(204).send();
    },
  );

  app.post("/qualite/revue-froide/echantillons/:id/terminer", async (request) => {
    const auth = exiger(request, "qualite.froide.relire");
    const { id } = paramsId.parse(request.params);
    const corps = revueFroideTerminaisonSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => terminerRevue(db, auth, id, corps.synthese));
  });
}

function routesPlan(app: FastifyInstance) {
  app.post("/qualite/revue-froide/campagnes/:id/actions", async (request, reply) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = actionFroideCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, (db) =>
      creerAction(db, auth, id, corps),
    );
    reply.status(201);
    return detail;
  });

  app.get("/qualite/revue-froide/campagnes/:id/plan", async (request) => {
    const auth = exiger(request, "qualite.froide.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => planCampagne(db, id));
  });

  // Actions : celles dont l'appelant est responsable, ou toutes pour qui gère la revue à froid.
  app.get("/qualite/revue-froide/actions", async (request) => {
    const auth = exiger(request, "mission.lire");
    const q = actionsFroidesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerActions(db, auth, q));
  });

  app.get("/qualite/revue-froide/actions/:id", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailAction(db, auth, id));
  });

  app.patch("/qualite/revue-froide/actions/:id", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const corps = actionFroideModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierAction(db, auth, id, corps));
  });
}

export const routesQualiteFroide: FastifyPluginAsync = async (app) => {
  // Traduction seule : l'enveloppe (et `details.violations`/`manquants`) est produite par le
  // gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurQualite(error);
  });
  routesCampagnes(app);
  routesRevues(app);
  routesPlan(app);
};
