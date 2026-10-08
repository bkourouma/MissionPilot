import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  analyseDerogationsQuerySchema,
  competenceCreationSchema,
  competenceModificationSchema,
  decisionCompetenceSchema,
  declarationCompetenceSchema,
  estimationDemandeSchema,
  matriceQuerySchema,
  propositionDerogationsSchema,
  rechercheQuerySchema,
  retoursQuerySchema,
  retourValidationSchema,
  retourVersionSchema,
  tacheBriqueSchema,
} from "@missionpilot/shared";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";
import {
  actualiserPreuvesCompetences,
  creerCompetence,
  deciderDeclaration,
  declarerCompetence,
  listerCompetences,
  matrice,
  mesCompetences,
  modifierCompetence,
} from "../capitalisation/competences.js";
import { analyseDerogations, proposerDepuisDerogations } from "../capitalisation/derogations.js";
import { traduireErreurCapitalisation } from "../capitalisation/erreurs.js";
import {
  briquesObservees,
  estimationParBrique,
  listerRattachements,
  rattacherTacheBrique,
} from "../capitalisation/estimation.js";
import { genererRetourIa } from "../capitalisation/ia.js";
import { rechercher } from "../capitalisation/recherche.js";
import {
  ajouterVersion,
  estResponsableMission,
  listerRetours,
  lireRetour,
  lireRetourMission,
  ouvrirRetourExperience,
  validerRetour,
} from "../capitalisation/retours.js";
import { interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { envoyerEmails } from "../notifications/notifier.js";

/**
 * CAP : retour d'expérience, base d'estimation, analyse des dérogations, compétences, recherche
 * unifiée (PRD complémentaire §12 : CAP-01, 02, 05, 06, 07), monté sous /api par `app.ts`.
 *
 * Droits : `connaissance.lire` (recherche, retours d'expérience, estimation ; mission visible
 * TOUJOURS exigée en plus pour ce qui s'y rattache ; `budget.lire_jours` en plus pour
 * l'estimation, et pour la section « Écarts » des retours, absente sans ce droit) ; `mission.planifier` ET responsable de la
 * mission (chef, directeur ou associé) pour ouvrir, rédiger, générer et valider un retour ;
 * `standard.gerer` pour l'analyse des dérogations (comité méthode) ; `competence.lire` pour
 * la matrice de tous, `competence.gerer` pour le référentiel et la validation des niveaux,
 * `temps.saisir` pour déclarer ses propres niveaux et lire les siens. Aucune route n'est ouverte au portail client (liste blanche
 * fermée). Historiques en ajout seul (migrations 0460 à 0463) ; chaque écriture est journalisée.
 */

const paramsTache = z.object({ id: z.string().uuid(), tache_id: z.string().uuid() }).strict();

function routesRetours(app: FastifyInstance) {
  const deps = () => ({
    config: app.config,
    journal: (e: unknown) => app.log.info({ ia: e }),
  });

  app.get("/capitalisation/retours", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const q = retoursQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerRetours(db, auth, q));
  });

  app.get("/capitalisation/retours/:id", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireRetour(db, auth, id));
  });

  app.get("/capitalisation/missions/:id/retour", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireRetourMission(db, auth, id));
  });

  app.post("/capitalisation/missions/:id/retour", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const retour = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      if (!estResponsableMission(auth, mission)) throw interdit();
      return ouvrirRetourExperience(db, auth, id);
    });
    reply.status(201);
    return retour;
  });

  app.post("/capitalisation/retours/:id/versions", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const corps = retourVersionSchema.parse(request.body);
    const retour = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterVersion(db, auth, id, corps),
    );
    reply.status(201);
    return retour;
  });

  app.post("/capitalisation/retours/:id/ia", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    const { retour, resultat } = await genererRetourIa(app.db, deps(), auth, id);
    await envoyerEmails(app.mailer, resultat.notifications, (m) => app.log.warn(m));
    reply.status(201);
    return retour;
  });

  app.post("/capitalisation/retours/:id/valider", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const corps = retourValidationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => validerRetour(db, auth, id, corps));
  });
}

function routesEstimation(app: FastifyInstance) {
  app.get("/capitalisation/missions/:id/briques", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => listerRattachements(db, auth, id));
  });

  app.put("/capitalisation/missions/:id/taches/:tache_id/brique", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id, tache_id } = paramsTache.parse(request.params);
    const { brique_code } = tacheBriqueSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) =>
      rattacherTacheBrique(db, auth, id, tache_id, brique_code),
    );
  });

  app.post("/capitalisation/estimation", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    // Durées réelles en jours : `budget.lire_jours` en plus (l'expert métier n'a pas ce droit).
    exiger(request, "budget.lire_jours");
    const demande = estimationDemandeSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => estimationParBrique(db, demande));
  });

  app.get("/capitalisation/estimation/briques", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    return app.db.withTenant(auth.cabinetId, (db) => briquesObservees(db));
  });
}

function routesDerogations(app: FastifyInstance) {
  app.get("/capitalisation/derogations/analyse", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const q = analyseDerogationsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => analyseDerogations(db, auth, q));
  });

  app.post("/capitalisation/derogations/propositions", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = propositionDerogationsSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      proposerDepuisDerogations(db, auth, corps),
    );
    reply.status(201);
    return r;
  });
}

function routesCompetences(app: FastifyInstance) {
  app.get("/capitalisation/competences", async (request) => {
    const auth = exiger(request, "temps.saisir");
    return app.db.withTenant(auth.cabinetId, (db) => listerCompetences(db));
  });

  app.post("/capitalisation/competences", async (request, reply) => {
    const auth = exiger(request, "competence.gerer");
    const corps = competenceCreationSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => creerCompetence(db, auth, corps));
    reply.status(201);
    return r;
  });

  app.patch("/capitalisation/competences/:id", async (request) => {
    const auth = exiger(request, "competence.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = competenceModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierCompetence(db, auth, id, corps));
  });

  app.get("/capitalisation/competences/matrice", async (request) => {
    // Matrice de TOUS les collaborateurs : donnée d'évaluation individuelle, `competence.lire`
    // (associé, directeur de mission, ressources) ; temps et preuves exigent en plus
    // `budget.lire_jours` (champs absents sinon). Les autres rôles : `/competences/moi`.
    const auth = exiger(request, "competence.lire");
    const q = matriceQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => matrice(db, auth, q));
  });

  app.get("/capitalisation/competences/moi", async (request) => {
    const auth = exiger(request, "temps.saisir");
    return app.db.withTenant(auth.cabinetId, (db) => mesCompetences(db, auth));
  });

  app.post("/capitalisation/competences/declarations", async (request, reply) => {
    const auth = exiger(request, "temps.saisir");
    const corps = declarationCompetenceSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => declarerCompetence(db, auth, corps));
    reply.status(201);
    return r;
  });

  app.post("/capitalisation/competences/declarations/:id/decision", async (request, reply) => {
    const auth = exiger(request, "competence.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = decisionCompetenceSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      deciderDeclaration(db, auth, id, corps),
    );
    reply.status(201);
    return r;
  });

  app.post("/capitalisation/missions/:id/competences/actualiser", async (request) => {
    const auth = exiger(request, "competence.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return { preuves_ajoutees: await actualiserPreuvesCompetences(db, id) };
    });
  });
}

export const routesCapitalisation: FastifyPluginAsync = async (app) => {
  // Traduction seule : l'enveloppe est produite par le gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurCapitalisation(error);
  });
  routesRetours(app);
  routesEstimation(app);
  routesDerogations(app);
  routesCompetences(app);

  app.get("/capitalisation/recherche", async (request) => {
    const auth = exiger(request, "connaissance.lire");
    const q = rechercheQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => rechercher(db, auth, q));
  });
};
