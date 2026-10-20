import type { FastifyPluginAsync } from "fastify";
import { parametresRelanceSchema, relanceManuelleSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerOuDifferer } from "../notifications/file-email.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { relancerFactureManuellement } from "../finance/relance-manuelle.js";
import { lireParametresRelances } from "../finance/relances.js";

/**
 * Relances des factures (FIN-09) : paramètres du cabinet et relance manuelle,
 * « encaissement.gerer » (gestionnaire, associé). Les relances automatiques
 * sont créées par la tâche quotidienne (finance/relances.ts).
 */
export const routesRelances: FastifyPluginAsync = async (app) => {
  app.get("/finance/parametres-relances", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresRelances(db));
  });

  app.patch("/finance/parametres-relances", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const modif = parametresRelanceSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const p = { ...(await lireParametresRelances(db)), ...modif };
      await db.query(
        `INSERT INTO parametres_relances (cabinet_id, delais_relance, relances_actives,
           envoi_email_client, valeurs_validees, modifie_par)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cabinet_id) DO UPDATE SET delais_relance = EXCLUDED.delais_relance,
           relances_actives = EXCLUDED.relances_actives,
           envoi_email_client = EXCLUDED.envoi_email_client,
           valeurs_validees = EXCLUDED.valeurs_validees, modifie_par = EXCLUDED.modifie_par,
           modifie_le = now()`,
        [
          auth.cabinetId,
          p.delais_relance,
          p.relances_actives,
          p.envoi_email_client,
          p.valeurs_validees,
          auth.utilisateurId,
        ],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "parametres_relances",
        details: modif,
      });
      return lireParametresRelances(db);
    });
  });

  /**
   * Relance manuelle d'une facture émise restant due : niveau suivant par
   * défaut (au plus 3) ; e-mail au contact du client seulement si demandé
   * (`envoyer_email`, faux par défaut ; après la transaction, repris par la
   * file d'e-mails en cas d'échec). Une seconde relance manuelle avec e-mail
   * pour la même facture le même jour : 409 RELANCE_DEJA_ENVOYEE.
   */
  app.post("/factures/:id/relances", async (request, reply) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    const demande = relanceManuelleSchema.parse(request.body ?? {});
    const date = aujourdhui();
    const { relance, email, notifications } = await app.db.withTenant(auth.cabinetId, (db) =>
      relancerFactureManuellement(db, auth, id, demande, date),
    );
    if (email) {
      void envoyerOuDifferer({
        database: app.db,
        mailer: app.mailer,
        trousseau: trousseauDepuisConfig(app.config),
        cabinetId: auth.cabinetId,
        journal: (m) => request.log.warn(m),
        message: email,
      });
    }
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    reply.status(201);
    return relance;
  });
};
