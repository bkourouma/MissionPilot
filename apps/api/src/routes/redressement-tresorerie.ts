import type { FastifyPluginAsync } from "fastify";
import {
  redPointMortSchema,
  redRealiseCreationSchema,
  redTresorerieVersionCreationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import { enregistrerRealise } from "../redressement/realises.js";
import {
  calculerPointMortRed,
  creerVersionTresorerie,
  lireTresorerie,
  proposerEcheancesAccords,
} from "../redressement/tresorerie.js";

/*
 * Trésorerie à 13 semaines et point mort (RED-06 en partie, RED-11, routes 18 à 22), plugin de
 * routes/redressement.ts. Droits : `redressement.lire` (lecture, simulation) et
 * `redressement.ecrire` (versions, réalisés). Soldes, écarts, semaines de tension et besoin de
 * financement sortent du moteur à chaque lecture ; le point mort est un calcul pur (aucune écriture,
 * aucun journal, corps de 2 Ko au plus : pas de plafond de débit, SPEC-3a §9.5).
 */
export const routesRedressementTresorerie: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/tresorerie", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireTresorerie(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/tresorerie/versions", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redTresorerieVersionCreationSchema.parse(request.body);
    const t = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerVersionTresorerie(
        db,
        auth,
        (await exigerDossierRedEcriture(db, auth, id)).dossier,
        corps,
      ),
    );
    reply.status(201);
    return t;
  });

  app.post("/redressement/dossiers/:id/tresorerie/realises", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redRealiseCreationSchema.parse(request.body);
    const t = await app.db.withTenant(auth.cabinetId, async (db) =>
      enregistrerRealise(db, auth, (await exigerDossierRedEcriture(db, auth, id)).dossier, corps),
    );
    reply.status(201);
    return t;
  });

  app.get("/redressement/dossiers/:id/tresorerie/echeances-accords", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      proposerEcheancesAccords(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/point-mort", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const corps = redPointMortSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, (db) => exigerDossierRedVisible(db, auth, id));
    return calculerPointMortRed(corps);
  });
};
