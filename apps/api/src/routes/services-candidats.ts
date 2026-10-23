import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  activationServiceSchema,
  guichetCreationSchema,
  guichetModificationSchema,
  guichetsQuerySchema,
  guichetsRapprochementSchema,
  prixFixeSchema,
  serviceCandidatCodeSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { traduireErreurServicesCandidats } from "../services-candidats/erreurs.js";
import {
  creerGuichet,
  lireGuichet,
  listerGuichets,
  modifierGuichet,
  rapprocher,
} from "../services-candidats/guichets.js";
import { activerTypes, fixerPrix, lireServices } from "../services-candidats/services.js";

/*
 * Services candidats (diagnostic flash, business plan bancable) et guichets de financement.
 * Toutes ces routes sont INTERNES : aucune n'est dans LISTE_BLANCHE_PORTAIL (portail → 403).
 * Droits : `services_candidats.lire` (lecture, rapprochement), `services_candidats.gerer`
 * (associé et directeur de mission : activation, prix, guichets) ; le rapprochement depuis un client exige en plus
 * `dossier.lire` et un dossier visible (404 sinon).
 *
 * - GET /services-candidats, POST /services-candidats/activer, PUT /services-candidats/:code/prix ;
 * - GET et POST /guichets-financement, GET et PATCH /guichets-financement/:id ;
 * - POST /guichets-financement/rapprochement.
 * La mission se crée par les routes existantes : POST /missions (type du service) puis
 * PUT /missions/:id/methode (version publiée de la méthode).
 */

const paramsCode = z.object({ code: serviceCandidatCodeSchema }).strict();

export const routesServicesCandidats: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurServicesCandidats(error);
  });

  app.get("/services-candidats", async (request) => {
    const auth = exiger(request, "services_candidats.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => ({ elements: await lireServices(db) }));
  });

  app.post("/services-candidats/activer", async (request) => {
    const auth = exiger(request, "services_candidats.gerer");
    const { service } = activationServiceSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => activerTypes(db, auth, service));
  });

  app.put("/services-candidats/:code/prix", async (request) => {
    const auth = exiger(request, "services_candidats.gerer");
    const { code } = paramsCode.parse(request.params);
    const prix = prixFixeSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => fixerPrix(db, auth, code, prix));
  });

  app.get("/guichets-financement", async (request) => {
    const auth = exiger(request, "services_candidats.lire");
    const filtre = guichetsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerGuichets(db, filtre));
  });

  app.post("/guichets-financement", async (request, reply) => {
    const auth = exiger(request, "services_candidats.gerer");
    const corps = guichetCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, (db) => creerGuichet(db, auth, corps));
    reply.status(201);
    return cree;
  });

  app.post("/guichets-financement/rapprochement", async (request) => {
    const auth = exiger(request, "services_candidats.lire");
    const corps = guichetsRapprochementSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => rapprocher(db, auth, corps));
  });

  app.get("/guichets-financement/:id", async (request) => {
    const auth = exiger(request, "services_candidats.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireGuichet(db, id));
  });

  app.patch("/guichets-financement/:id", async (request) => {
    const auth = exiger(request, "services_candidats.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = guichetModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierGuichet(db, auth, id, corps));
  });
};
