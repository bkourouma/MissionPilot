import type { FastifyPluginAsync } from "fastify";
import {
  redCovenantsVersionCreationSchema,
  redFinancementPropositionQuerySchema,
  redFinancementVersionCreationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import { creerVersionCovenants, lireCovenants } from "../redressement/covenants.js";
import {
  creerVersionFinancement,
  lireFinancement,
  proposerFinancement,
} from "../redressement/financement.js";
import { lireTresorerieMensuelle } from "../redressement/tresorerie-mensuelle.js";

/*
 * Vue mensuelle de la trésorerie, covenants bancaires et plan de financement (RED-06, lot 2),
 * plugin de routes/redressement.ts. Droits : `redressement.lire` (lectures, proposition) et
 * `redressement.ecrire` (nouvelles versions, dossier non clos). Aucun calcul ici : les flux
 * mensuels, l'évaluation des covenants (constat arithmétique, jamais une qualification juridique)
 * et les totaux du plan sortent des moteurs à chaque lecture ; les versions sont en ajout seul.
 */
export const routesRedressementFinancement: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/tresorerie/mensuelle", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireTresorerieMensuelle(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.get("/redressement/dossiers/:id/covenants", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireCovenants(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/covenants/versions", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCovenantsVersionCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerVersionCovenants(
        db,
        auth,
        (await exigerDossierRedEcriture(db, auth, id)).dossier,
        corps,
      ),
    );
    reply.status(201);
    return vue;
  });

  app.get("/redressement/dossiers/:id/financement", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lireFinancement(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  app.post("/redressement/dossiers/:id/financement/versions", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redFinancementVersionCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerVersionFinancement(
        db,
        auth,
        (await exigerDossierRedEcriture(db, auth, id)).dossier,
        corps,
      ),
    );
    reply.status(201);
    return vue;
  });

  app.get("/redressement/dossiers/:id/financement/proposition", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const query = redFinancementPropositionQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      proposerFinancement(db, (await exigerDossierRedVisible(db, auth, id)).dossier, query),
    );
  });
};
