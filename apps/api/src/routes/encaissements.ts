import type { FastifyPluginAsync } from "fastify";
import {
  contrePassationDemandeSchema,
  contrePassationRejetSchema,
  contrePassationsListeQuerySchema,
  creancesQuerySchema,
  encaissementCreationSchema,
  encaissementsListeQuerySchema,
  imputationsAjoutSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { exigerFactureVisible } from "../facturation/factures.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import {
  COLONNES_LISTE_ENCAISSEMENT,
  creerEncaissement,
  demanderContrePassation,
  DEPUIS_LISTE_ENCAISSEMENT,
  imputerAvance,
  lireDemande,
  lireEncaissement,
  rejeterContrePassation,
  validerContrePassation,
  versEncaissement,
  vueEncaissement,
} from "../finance/encaissements.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationFacture,
  situationPaiement,
  versFacturePaiement,
  vueSituation,
} from "../finance/paiements.js";

const CLE_RECENTE = `lpad((99999999 - (e.date_encaissement - date '2000-01-01'))::text, 8, '0')
  || lpad((99999999999999999 - (extract(epoch FROM e.saisi_le) * 1000000)::bigint)::text, 17, '0')`;

function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  id: string,
  details: Record<string, unknown> = {},
) {
  // Journal sans montant : identifiants, mode, nombre d'imputations.
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details,
  });
}

/**
 * Encaissements, imputations et contre-passations (FIN-09) :
 * « encaissement.gerer » (gestionnaire, associé). La situation de paiement
 * d'une facture se lit avec « facture.lire » sur une mission visible.
 */
export const routesEncaissements: FastifyPluginAsync = async (app) => {
  app.get("/finance/encaissements", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const q = encaissementsListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_LISTE_ENCAISSEMENT}, ${CLE_RECENTE} AS cle_tri
         FROM ${DEPUIS_LISTE_ENCAISSEMENT}
         WHERE ($1::uuid IS NULL OR e.client_id = $1)
           AND ($2::date IS NULL OR e.date_encaissement >= $2)
           AND ($3::date IS NULL OR e.date_encaissement <= $3)
           AND ($4::text IS NULL OR (${CLE_RECENTE}, e.id) > ($4, $5::uuid))
         ORDER BY cle_tri, e.id LIMIT $6`,
        [
          q.client_id ?? null,
          q.du ?? null,
          q.au ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows, q.limite);
      return {
        ...page,
        elements: page.elements.map((e) => versEncaissement(e as Record<string, unknown>)),
      };
    });
  });

  app.post("/finance/encaissements", async (request, reply) => {
    const auth = exiger(request, "encaissement.gerer");
    const saisie = encaissementCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const id = await creerEncaissement(db, auth, saisie);
      await journal(db, auth, "creation", "encaissement", id, {
        client_id: saisie.client_id,
        mode: saisie.mode,
        imputations: saisie.imputations.length,
        factures: saisie.imputations.map((i) => i.facture_id),
      });
      return vueEncaissement(db, await lireEncaissement(db, id));
    });
    reply.status(201);
    return cree;
  });

  app.get("/finance/encaissements/:id", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueEncaissement(db, await lireEncaissement(db, id)),
    );
  });

  /** Imputation ultérieure de l'avance (part non imputée) d'un encaissement. */
  app.post("/finance/encaissements/:id/imputations", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    const { imputations } = imputationsAjoutSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await imputerAvance(db, auth, id, imputations);
      await journal(db, auth, "imputation_avance", "encaissement", id, {
        factures: imputations.map((i) => i.facture_id),
      });
      return vueEncaissement(db, await lireEncaissement(db, id));
    });
  });

  app.post("/finance/encaissements/:id/contre-passation", async (request, reply) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    const { motif } = contrePassationDemandeSchema.parse(request.body);
    const demande = await app.db.withTenant(auth.cabinetId, async (db) => {
      const demandeId = await demanderContrePassation(db, auth, id, motif);
      await journal(db, auth, "demande_contre_passation", "encaissement", id, {
        demande_id: demandeId,
        motif,
      });
      return lireDemande(db, demandeId);
    });
    reply.status(201);
    return demande;
  });

  app.get("/finance/contre-passations", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const q = contrePassationsListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    const cle = `lpad((99999999999999999 - (extract(epoch FROM demandee_le) * 1000000)::bigint)::text, 17, '0')`;
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT id, encaissement_id, motif, statut, demandee_par, demandee_le, decidee_par, decidee_le,
           motif_rejet, encaissement_negatif_id, ${cle} AS cle_tri
         FROM contre_passations
         WHERE ($1::text IS NULL OR statut = $1)
           AND ($2::text IS NULL OR (${cle}, id) > ($2, $3::uuid))
         ORDER BY cle_tri, id LIMIT $4`,
        [q.statut ?? null, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      return paginer(r.rows, q.limite);
    });
  });

  /** Validation par un autre que le demandeur (sauf associé) : crée l'encaissement négatif. */
  app.post("/finance/contre-passations/:id/valider", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const negatifId = await validerContrePassation(db, auth, id);
      const d = await lireDemande(db, id);
      await journal(db, auth, "contre_passation", "encaissement", d.encaissement_id, {
        demande_id: id,
        encaissement_negatif_id: negatifId,
      });
      return {
        demande: d,
        contre_passation: await vueEncaissement(db, await lireEncaissement(db, negatifId)),
      };
    });
  });

  app.post("/finance/contre-passations/:id/rejeter", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const { id } = paramsId.parse(request.params);
    const { motif } = contrePassationRejetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await rejeterContrePassation(db, auth, id, motif);
      const d = await lireDemande(db, id);
      await journal(db, auth, "rejet_contre_passation", "encaissement", d.encaissement_id, {
        demande_id: id,
        motif,
      });
      return d;
    });
  });

  /** Factures émises restant dues (statut de paiement dérivé), pour l'imputation. */
  app.get("/finance/creances", async (request) => {
    const auth = exiger(request, "encaissement.gerer");
    const q = creancesQuerySchema.parse(request.query);
    const date = q.date ?? aujourdhui();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_FACTURE_PAIEMENT}, cl.raison_sociale AS client_raison_sociale
         FROM factures f JOIN missions m ON m.id = f.mission_id JOIN clients cl ON cl.id = f.client_id
         WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_emission <= $1
           AND ($2::uuid IS NULL OR f.client_id = $2) AND ${filtreVisibilite(3, 4)}
         ORDER BY f.date_echeance, f.numero`,
        [date, q.client_id ?? null, voitToutesLesMissions(auth), auth.utilisateurId],
      );
      const factures = r.rows.map((l) => ({
        brut: l,
        facture: versFacturePaiement(l),
      }));
      const imputations = await imputationsParFacture(
        db,
        factures.map((f) => f.facture.id),
        date,
      );
      return {
        date,
        elements: factures
          .map(({ brut, facture }) => ({
            brut,
            facture,
            situation: situationPaiement(facture, imputations.get(facture.id) ?? [], date),
          }))
          .filter(({ situation }) => situation.statut_paiement !== "soldee")
          .map(({ brut, facture, situation }) => ({
            facture_id: facture.id,
            numero: facture.numero,
            mission_id: facture.mission_id,
            client_id: facture.client_id,
            client_raison_sociale: brut.client_raison_sociale as string,
            date_emission: facture.date_emission,
            date_echeance: facture.date_echeance,
            ...vueSituation(situation),
          })),
      };
    });
  });

  /** Situation de paiement d'une facture, imputations et relances (sans coût ni marge). */
  app.get("/factures/:id/paiement", async (request) => {
    const auth = exiger(request, "facture.lire");
    const { id } = paramsId.parse(request.params);
    const date = aujourdhui();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerFactureVisible(db, auth, id);
      const s = await situationFacture(db, id, date);
      const imputations = await db.query(
        `SELECT i.id, i.encaissement_id, e.mode, e.date_encaissement::text AS date_encaissement,
           i.montant, i.origine, i.date_imputation::text AS date_imputation
         FROM imputations i JOIN encaissements e ON e.id = i.encaissement_id
         WHERE i.facture_id = $1 ORDER BY i.date_imputation, i.cree_le, i.id`,
        [id],
      );
      const relances = await db.query(
        `SELECT id, niveau, mode, date_relance::text AS date_relance, jours_retard, email_envoye,
           (destinataire_email IS NOT NULL) AS email_prepare, cree_par, cree_le
         FROM relances_factures WHERE facture_id = $1 ORDER BY cree_le, id`,
        [id],
      );
      return {
        facture_id: id,
        date,
        ...(s ? vueSituation(s.situation) : {}),
        imputations: imputations.rows.map((i) => ({ ...i, montant: Number(i.montant) })),
        relances: relances.rows,
      };
    });
  });
};
