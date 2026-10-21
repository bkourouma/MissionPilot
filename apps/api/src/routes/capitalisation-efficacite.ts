import type { FastifyPluginAsync } from "fastify";
import {
  efficaciteAbandonSchema,
  efficaciteListeQuerySchema,
  efficaciteMiseEnOeuvreSchema,
  efficaciteRecommandationCreationSchema,
  efficaciteScoresQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import {
  abandonner,
  creerRecommandation,
  lireRecommandation,
  listerRecommandations,
  mesurerEffet,
  mettreEnOeuvre,
  optionsMission,
  scoresEfficacite,
} from "../capitalisation/efficacite.js";
import { traduireErreurEfficacite } from "../capitalisation/efficacite-erreurs.js";
import { paramsId } from "../http/outils.js";

/**
 * CAP-03, efficacité des recommandations, monté sous /api par `app.ts`.
 *
 * Droits : `connaissance.lire` pour la liste et les scores par contexte (agrégats du cabinet) ;
 * le détail exige en plus une mission visible (404 sinon). Écriture (recommander, mettre en
 * oeuvre, abandonner, mesurer l'effet) : `mission.planifier`, `plan.lire` et `kpi.lire`, ET
 * responsable de la mission. Aucune route n'est ouverte au portail client (liste blanche
 * fermée). Historiques en ajout seul (migrations 0466 et 0467) ; chaque écriture est journalisée.
 */

const BASE = "/capitalisation/efficacite";

function exigerEcriture(request: Parameters<typeof exiger>[0]) {
  const auth = exiger(request, "mission.planifier");
  exiger(request, "plan.lire");
  exiger(request, "kpi.lire");
  return auth;
}

export const routesEfficacite: FastifyPluginAsync = async (app) => {
  // Traduction seule : l'enveloppe est produite par le gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurEfficacite(error);
  });

  app.get(`${BASE}/recommandations`, async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const q = efficaciteListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerRecommandations(db, auth, q));
  });

  app.get(`${BASE}/scores`, async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const q = efficaciteScoresQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => scoresEfficacite(db, q));
  });

  app.get(`${BASE}/missions/:id/options`, async (request) => {
    const auth = exigerEcriture(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => optionsMission(db, auth, id));
  });

  app.get(`${BASE}/recommandations/:id`, async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireRecommandation(db, auth, id));
  });

  app.post(`${BASE}/recommandations`, async (request, reply) => {
    const auth = exigerEcriture(request);
    const corps = efficaciteRecommandationCreationSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => creerRecommandation(db, auth, corps));
    reply.status(201);
    return r;
  });

  app.post(`${BASE}/recommandations/:id/mise-en-oeuvre`, async (request) => {
    const auth = exigerEcriture(request);
    const { id } = paramsId.parse(request.params);
    const corps = efficaciteMiseEnOeuvreSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => mettreEnOeuvre(db, auth, id, corps));
  });

  app.post(`${BASE}/recommandations/:id/abandon`, async (request) => {
    const auth = exigerEcriture(request);
    const { id } = paramsId.parse(request.params);
    const corps = efficaciteAbandonSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => abandonner(db, auth, id, corps));
  });

  app.post(`${BASE}/recommandations/:id/mesurer`, async (request, reply) => {
    const auth = exigerEcriture(request);
    const { id } = paramsId.parse(request.params);
    const r = await app.db.withTenant(auth.cabinetId, (db) => mesurerEffet(db, auth, id));
    reply.status(201);
    return r;
  });
};
