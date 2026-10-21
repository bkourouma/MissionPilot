import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  observatoireAdhesionSchema,
  observatoireIndicateurQuerySchema,
  observatoireRetraitAdhesionSchema,
  observatoireRetraitContributionsSchema,
  observatoireVersementSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import {
  adherer,
  agregats,
  etatAdhesion,
  resumeContributions,
  retirerContributions,
  seRetirer,
  verser,
} from "../capitalisation/observatoire.js";
import { traduireErreurObservatoire } from "../capitalisation/observatoire-erreurs.js";
import { interdit } from "../errors.js";

/**
 * Observatoire inter-cabinets (CAP-04, PRD complémentaire §12, §21 décision n° 1), monté sous
 * /api par `app.ts`. Contrat HTTP : en-tête de `packages/shared/src/schemas/observatoire.ts`.
 *
 * Droits : `observatoire.adherer` (associé seul) pour adhérer, se retirer, verser et retirer ses
 * contributions, et lire ses propres volumes ; `observatoire.lire` (associé, directeur de mission)
 * ET adhésion active pour les agrégats (403 OBSERVATOIRE_RESERVE_ADHERENTS sinon) ; l'état de
 * l'adhésion se lit avec l'un ou l'autre droit. Aucune route n'est ouverte au portail client
 * (liste blanche fermée). Chaque écriture est journalisée (`capitalisation/observatoire.ts`).
 */
export const routesObservatoire: FastifyPluginAsync = async (app) => {
  // Traduction seule : l'enveloppe est produite par le gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurObservatoire(error);
  });

  app.get("/observatoire/adhesion", async (request) => {
    const auth = exiger(request);
    if (
      !aPermission(auth.roles, "observatoire.adherer") &&
      !aPermission(auth.roles, "observatoire.lire")
    ) {
      throw interdit();
    }
    return app.db.withTenant(auth.cabinetId, (db) => etatAdhesion(db));
  });

  app.post("/observatoire/adhesion", async (request, reply) => {
    const auth = exiger(request, "observatoire.adherer");
    const corps = observatoireAdhesionSchema.parse(request.body ?? {});
    const etat = await app.db.withTenant(auth.cabinetId, (db) => adherer(db, auth, corps));
    reply.status(201);
    return etat;
  });

  app.post("/observatoire/adhesion/retrait", async (request) => {
    const auth = exiger(request, "observatoire.adherer");
    const corps = observatoireRetraitAdhesionSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => seRetirer(db, auth, corps));
  });

  app.post("/observatoire/contributions", async (request, reply) => {
    const auth = exiger(request, "observatoire.adherer");
    const { indicateur } = observatoireVersementSchema.parse(request.body ?? {});
    const resultat = await app.db.withTenant(auth.cabinetId, (db) => verser(db, auth, indicateur));
    reply.status(201);
    return resultat;
  });

  app.get("/observatoire/contributions/resume", async (request) => {
    const auth = exiger(request, "observatoire.adherer");
    const { indicateur } = observatoireIndicateurQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      resumeContributions(db, auth.cabinetId, indicateur),
    );
  });

  app.delete("/observatoire/contributions", async (request) => {
    const auth = exiger(request, "observatoire.adherer");
    return app.db.withTenant(auth.cabinetId, (db) => retirerContributions(db, auth));
  });

  app.post("/observatoire/contributions/retrait", async (request) => {
    const auth = exiger(request, "observatoire.adherer");
    observatoireRetraitContributionsSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => retirerContributions(db, auth));
  });

  app.get("/observatoire/agregats", async (request) => {
    const auth = exiger(request, "observatoire.lire");
    const { indicateur } = observatoireIndicateurQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => agregats(db, auth, indicateur));
  });
};
