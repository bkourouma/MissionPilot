import type { FastifyPluginAsync } from "fastify";
import {
  redCorrespondanceCreationSchema,
  redDossierCreationSchema,
  redDossierModificationSchema,
  redDossierStatutSchema,
  redHistoriqueQuerySchema,
  redListeDossiersQuerySchema,
  redUrgenceCreationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import { creerCorrespondance, lireCorrespondances } from "../redressement/correspondances.js";
import {
  changerStatutDossier,
  dossierDeMission,
  listerDossiers,
  modifierDossier,
  ouvrirDossier,
  vueDossier,
} from "../redressement/dossiers.js";
import { traduireErreurRedressement } from "../redressement/erreurs.js";
import { lireRatios } from "../redressement/ratios.js";
import { referentiel } from "../redressement/referentiel.js";
import { creerUrgence, listerUrgences } from "../redressement/urgence.js";
import { routesRedressementAlerte } from "./redressement-alerte.js";
import { routesRedressementCreanciers } from "./redressement-creanciers.js";
import { routesRedressementPlan } from "./redressement-plan.js";
import { routesRedressementTresorerie } from "./redressement-tresorerie.js";

/*
 * Redressement, restructuration et mise à niveau (service #5, lot 3a), monté sous /api : dossiers,
 * correspondance de postes, ratios, urgence (routes 1 à 12), puis les quatre plugins du module
 * (SPEC-3a §9.3). Droits : permissions `redressement.*` de packages/shared/src/roles.ts et règles
 * de redressement/acces.ts (visibilité de la mission TOUJOURS exigée en plus ; un identifiant
 * invisible, inconnu ou d'un autre cabinet répond 404). Tous les chiffres sortent du moteur
 * (packages/engines/src/redressement). FERMÉ AU PORTAIL : aucune de ces routes n'est dans
 * LISTE_BLANCHE_PORTAIL et les quinze tables sont en `portail_interdit`. Aucune IA, aucun job.
 * Chaque écriture est journalisée dans sa transaction (identifiants, comptes et codes seulement).
 */

export const routesRedressement: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurRedressement(error);
  });

  /* ----- Référentiel (aucune lecture en base) ----- */

  app.get("/redressement/referentiel", async (request, reply) => {
    exiger(request, "redressement.lire");
    reply.header("cache-control", "private");
    return referentiel();
  });

  /* ----- Dossiers ----- */

  app.get("/redressement/dossiers", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const q = redListeDossiersQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerDossiers(db, auth, q));
  });

  app.post("/missions/:id/redressement", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redDossierCreationSchema.parse(request.body);
    const dossier = await app.db.withTenant(auth.cabinetId, (db) =>
      ouvrirDossier(db, auth, id, corps),
    );
    reply.status(201);
    return dossier;
  });

  app.get("/missions/:id/redressement", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const dossierId = await dossierDeMission(db, id);
      return vueDossier(db, auth, await exigerDossierRedVisible(db, auth, dossierId));
    });
  });

  app.get("/redressement/dossiers/:id", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueDossier(db, auth, await exigerDossierRedVisible(db, auth, id)),
    );
  });

  app.patch("/redressement/dossiers/:id", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redDossierModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      modifierDossier(db, auth, await exigerDossierRedEcriture(db, auth, id), corps),
    );
  });

  app.post("/redressement/dossiers/:id/statut", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redDossierStatutSchema.parse(request.body);
    // Clore un dossier est un acte de validation : `redressement.valider` en plus.
    if (corps.statut === "clos") exiger(request, "redressement.valider");
    return app.db.withTenant(auth.cabinetId, async (db) =>
      changerStatutDossier(db, auth, await exigerDossierRedEcriture(db, auth, id), corps),
    );
  });

  /* ----- RED-02 : correspondance de postes et ratios ----- */

  app.get("/redressement/dossiers/:id/correspondances", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireCorrespondances(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/correspondances", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCorrespondanceCreationSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerCorrespondance(db, auth, (await exigerDossierRedEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return c;
  });

  app.get("/redressement/dossiers/:id/ratios", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireRatios(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  /* ----- RED-01 : urgence ----- */

  app.get("/redressement/dossiers/:id/urgences", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const q = redHistoriqueQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerUrgences(db, (await exigerDossierRedVisible(db, auth, id)).dossier, q),
    );
  });

  app.post("/redressement/dossiers/:id/urgences", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redUrgenceCreationSchema.parse(request.body);
    const u = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerUrgence(db, auth, (await exigerDossierRedEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return u;
  });

  await app.register(routesRedressementAlerte);
  await app.register(routesRedressementTresorerie);
  await app.register(routesRedressementCreanciers);
  await app.register(routesRedressementPlan);
};
