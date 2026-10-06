import type { FastifyPluginAsync } from "fastify";
import { comparer, zero } from "@missionpilot/engines";
import { parametresRelanceSchema, relanceManuelleSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import { conflit, requeteInvalide } from "../errors.js";
import { exigerFactureVisible } from "../facturation/factures.js";
import { paramsId } from "../http/outils.js";
import { aujourdhui } from "../missions/outils.js";
import type { MessageEmail } from "../notifications/mailer.js";
import { envoyerOuDifferer } from "../notifications/file-email.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { situationFacture } from "../finance/paiements.js";
import { enregistrerRelance, lireParametresRelances } from "../finance/relances.js";

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
   * défaut (au plus 3) ; e-mail au contact du client si demandé (après la
   * transaction, repris par la file d'e-mails en cas d'échec).
   */
  app.post("/factures/:id/relances", async (request, reply) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    const demande = relanceManuelleSchema.parse(request.body ?? {});
    const date = aujourdhui();
    const { relance, email, notifications } = await app.db.withTenant(
      auth.cabinetId,
      async (db) => {
        const { facture } = await exigerFactureVisible(db, auth, id, true);
        if (facture.nature !== "facture" || facture.statut !== "emise") {
          throw conflit("Seule une facture émise se relance.");
        }
        const s = await situationFacture(db, id, date);
        if (!s || comparer(s.situation.solde, zero(s.situation.solde.devise)) <= 0) {
          throw conflit("La facture est soldée : rien à relancer.");
        }
        const dernier = await db.query(
          "SELECT coalesce(max(niveau), 0)::int AS n FROM relances_factures WHERE facture_id = $1",
          [id],
        );
        const niveau = demande.niveau ?? Math.min(3, (dernier.rows[0].n as number) + 1);
        const creee = await enregistrerRelance(db, {
          cabinetId: auth.cabinetId,
          facture: s.facture,
          situation: s.situation,
          niveau,
          mode: "manuelle",
          date,
          envoyer: demande.envoyer_email,
          auteurId: auth.utilisateurId,
          message: demande.message ?? null,
        });
        if (!creee) throw conflit("Relance non enregistrée.");
        if (demande.envoyer_email && !creee.email) {
          throw requeteInvalide(
            "Aucun contact du client n'a d'adresse e-mail : ajouter un contact, ou relancer sans e-mail.",
          );
        }
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "relance",
          entite: "facture",
          entiteId: id,
          details: { niveau, mode: "manuelle", email: creee.email !== null },
        });
        const r = await db.query(
          `SELECT id, facture_id, niveau, mode, date_relance::text AS date_relance, jours_retard,
             destinataire_email, email_sujet, email_texte, email_envoye, cree_par, cree_le
           FROM relances_factures WHERE id = $1`,
          [creee.id],
        );
        return {
          relance: r.rows[0],
          email: creee.email as MessageEmail | null,
          notifications: creee.notifications,
        };
      },
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
