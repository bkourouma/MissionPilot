import type { FastifyPluginAsync } from "fastify";
import {
  redCausesGenerationSchema,
  redCausesModificationSchema,
  redCausesValidationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { exigerDossierRedVisible } from "../redressement/acces.js";
import { accesCartographie, listerCauses, validerCauses } from "../redressement/causes.js";
import { genererCausesIa, modifierCausesIa } from "../redressement/causes-ia.js";

/*
 * Causes racines proposées par l'IA (RED-04, lot 2), plugin de routes/redressement.ts. L'IA
 * propose (brouillon IA), un consultant modifie puis valide : seule une cartographie VALIDÉE est
 * exploitable dans un livrable. Droits : `redressement.lire` (lecture), `redressement.ecrire`
 * (demander une proposition, modifier, valider) ; la demande exige en plus `ia.utiliser`. Le
 * valideur n'est ni le demandeur ni l'auteur d'un rang, sauf associé (403 APPROBATION_REQUISE,
 * doublé en base MPZ07) ; des nombres que les moteurs n'ont pas produits exigent
 * `acquitte_chiffres: true` (409 CHIFFRES_NON_VERIFIES). Fermé au portail. Le journal d'audit ne
 * porte aucun texte de cause. Les e-mails éventuels partent APRÈS la validation de la transaction.
 */
export const routesRedressementCauses: FastifyPluginAsync = async (app) => {
  /** Route C1 : cartographies du dossier avec leur statut et leur historique. */
  app.get("/redressement/dossiers/:id/causes", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerCauses(db, (await exigerDossierRedVisible(db, auth, id)).dossier),
    );
  });

  /** Route C2 : demande de proposition (orchestrateur IA, repli déterministe), brouillon IA. */
  app.post("/redressement/dossiers/:id/causes/generation", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    const corps = redCausesGenerationSchema.parse(request.body ?? {});
    const { vue, resultat } = await genererCausesIa(
      app.db,
      { config: app.config, journal: (e: unknown) => app.log.info({ ia: e }) },
      auth,
      id,
      corps,
    );
    await envoyerEmails(app.mailer, resultat.notifications, (m) => request.log.warn(m));
    reply.status(201);
    return vue;
  });

  /** Route C3 : retouche d'un brouillon (nouveau rang « modifié »). */
  app.patch("/redressement/causes/:id", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCausesModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierCausesIa(db, auth, id, corps));
  });

  /** Route C4 : validation par un consultant (séparation des tâches, acquittement des nombres). */
  app.post("/redressement/causes/:id/validation", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redCausesValidationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) =>
      validerCauses(
        db,
        auth,
        await accesCartographie(db, auth, id),
        id,
        corps.acquitte_chiffres ?? false,
      ),
    );
  });
};
