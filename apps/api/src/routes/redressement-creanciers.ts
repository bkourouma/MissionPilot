import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  redCreanceCreationSchema,
  redCreancierCreationSchema,
  redCreancierModificationSchema,
  redEvenementNegociationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import {
  ajouterCreance,
  creancierEcriture,
  creancierVisible,
  creerCreancier,
  detailCreancier,
  lireCreanciers,
  modifierCreancier,
} from "../redressement/creanciers.js";
import { ajouterEvenement } from "../redressement/negociations.js";

/*
 * Registre des créanciers, créances, négociations, accords et échéanciers (RED-12, routes 23 à 28),
 * plugin de routes/redressement.ts. Droits : `redressement.lire` (lecture) et `redressement.ecrire`
 * (écritures). La situation (reste dû, échu, avancement de l'accord) est recalculée par le moteur
 * à chaque lecture. Le journal ne porte jamais un nom, un montant ni une condition de négociation.
 */

const queryActifs = z
  .object({ actifs: z.enum(["true", "false", "tous"]).default("true") })
  .strict();

export const routesRedressementCreanciers: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/creanciers", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const q = queryActifs.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireCreanciers(db, (await exigerDossierRedVisible(db, auth, id)).dossier, q.actifs),
    );
  });

  app.post("/redressement/dossiers/:id/creanciers", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCreancierCreationSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerCreancier(db, auth, (await exigerDossierRedEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return c;
  });

  app.get("/redressement/creanciers/:id", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossierId } = await creancierVisible(db, auth, id);
      return detailCreancier(db, dossierId, id);
    });
  });

  app.patch("/redressement/creanciers/:id", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCreancierModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      modifierCreancier(db, auth, (await creancierEcriture(db, auth, id)).creancier, corps),
    );
  });

  app.post("/redressement/creanciers/:id/creances", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCreanceCreationSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) =>
      ajouterCreance(db, auth, (await creancierEcriture(db, auth, id)).creancier, corps),
    );
    reply.status(201);
    return c;
  });

  app.post("/redressement/creanciers/:id/evenements", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redEvenementNegociationSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) =>
      ajouterEvenement(db, auth, (await creancierEcriture(db, auth, id)).creancier, corps),
    );
    reply.status(201);
    return c;
  });
};
