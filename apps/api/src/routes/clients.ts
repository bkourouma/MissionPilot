import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  clientCreationSchema,
  clientModificationSchema,
  contactCreationSchema,
  contactModificationSchema,
  listeQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, traduireErreursPg } from "../db/outils.js";
import { introuvable } from "../errors.js";
import { decoderCurseur, motifContient, paginer, paramsId } from "../http/outils.js";

const COLONNES_CLIENT = `id, raison_sociale, forme_juridique, rccm, compte_contribuable, secteur,
  pays, taille, adresse, actif, cree_le, modifie_le`;
const COLONNES_CONTACT =
  "id, client_id, nom, fonction, email, telephone, principal, cree_le, modifie_le";
const CHAMPS_CLIENT = [
  "raison_sociale",
  "forme_juridique",
  "rccm",
  "compte_contribuable",
  "secteur",
  "pays",
  "taille",
  "adresse",
  "actif",
] as const;
const CHAMPS_CONTACT = ["nom", "fonction", "email", "telephone", "principal"] as const;

const UNICITES = {
  clients_rccm_uniq: "Un client du cabinet porte déjà ce RCCM.",
  clients_compte_contribuable_uniq: "Un client du cabinet porte déjà ce compte contribuable.",
};

const paramsContact = z.object({ id: z.string().uuid(), contactId: z.string().uuid() });

async function exigerClient(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES_CLIENT} FROM clients WHERE id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Client");
  return r.rows[0];
}

/** Un seul contact principal par client. */
async function unSeulPrincipal(db: Db, clientId: string, contactId: string): Promise<void> {
  await db.query(
    "UPDATE contacts_client SET principal = false WHERE client_id = $1 AND id <> $2 AND principal",
    [clientId, contactId],
  );
}

/** Fiches clients (SOC-03) et contacts. */
export const routesClients: FastifyPluginAsync = async (app) => {
  app.get("/clients", async (request) => {
    const auth = exiger(request, "clients.lire");
    const q = listeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_CLIENT}, lower(raison_sociale) AS cle_tri FROM clients
         WHERE ($1::text IS NULL OR raison_sociale ILIKE $1 OR rccm ILIKE $1
                OR compte_contribuable ILIKE $1 OR secteur ILIKE $1)
           AND ($2::boolean IS NULL OR actif = $2)
           AND ($3::text IS NULL OR (lower(raison_sociale), id) > ($3, $4::uuid))
         ORDER BY lower(raison_sociale), id
         LIMIT $5`,
        [
          motifContient(q.q),
          q.actif === undefined ? null : q.actif === "true",
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows, q.limite);
    });
  });

  app.post("/clients", async (request, reply) => {
    const auth = exiger(request, "clients.ecrire");
    const client = clientCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO clients (cabinet_id, ${CHAMPS_CLIENT.join(", ")})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLONNES_CLIENT}`,
          [auth.cabinetId, ...CHAMPS_CLIENT.map((c) => client[c] ?? null)],
        ),
        UNICITES,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "client",
        entiteId: r.rows[0].id,
        details: { apres: choisir(r.rows[0], CHAMPS_CLIENT) },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.get("/clients/:id", async (request) => {
    const auth = exiger(request, "clients.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const client = await exigerClient(db, id);
      const contacts = await db.query(
        `SELECT ${COLONNES_CONTACT} FROM contacts_client WHERE client_id = $1
         ORDER BY principal DESC, lower(nom), id`,
        [id],
      );
      return { ...client, contacts: contacts.rows };
    });
  });

  app.patch("/clients/:id", async (request) => {
    const auth = exiger(request, "clients.ecrire");
    const { id } = paramsId.parse(request.params);
    const modif = clientModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerClient(db, id);
      const set = clauseSet(modif, 2);
      const r = await traduireErreursPg(
        db.query(
          `UPDATE clients SET ${set.sql}, modifie_le = now() WHERE id = $1 RETURNING ${COLONNES_CLIENT}`,
          [id, ...set.valeurs],
        ),
        UNICITES,
      );
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "client",
        entiteId: id,
        details: { avant: choisir(avant, champs), apres: choisir(r.rows[0], champs) },
      });
      return r.rows[0];
    });
  });

  app.get("/clients/:id/contacts", async (request) => {
    const auth = exiger(request, "clients.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerClient(db, id);
      const r = await db.query(
        `SELECT ${COLONNES_CONTACT} FROM contacts_client WHERE client_id = $1
         ORDER BY principal DESC, lower(nom), id`,
        [id],
      );
      return { elements: r.rows };
    });
  });

  app.post("/clients/:id/contacts", async (request, reply) => {
    const auth = exiger(request, "clients.ecrire");
    const { id } = paramsId.parse(request.params);
    const contact = contactCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerClient(db, id);
      const r = await db.query(
        `INSERT INTO contacts_client (cabinet_id, client_id, ${CHAMPS_CONTACT.join(", ")})
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLONNES_CONTACT}`,
        [auth.cabinetId, id, ...CHAMPS_CONTACT.map((c) => contact[c] ?? null)],
      );
      if (contact.principal) await unSeulPrincipal(db, id, r.rows[0].id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "contact_client",
        entiteId: r.rows[0].id,
        details: { client_id: id, apres: choisir(r.rows[0], CHAMPS_CONTACT) },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.patch("/clients/:id/contacts/:contactId", async (request) => {
    const auth = exiger(request, "clients.ecrire");
    const { id, contactId } = paramsContact.parse(request.params);
    const modif = contactModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = (
        await db.query(
          `SELECT ${COLONNES_CONTACT} FROM contacts_client WHERE id = $1 AND client_id = $2`,
          [contactId, id],
        )
      ).rows[0];
      if (!avant) throw introuvable("Contact");
      const set = clauseSet(modif, 3);
      const r = await db.query(
        `UPDATE contacts_client SET ${set.sql}, modifie_le = now()
         WHERE id = $1 AND client_id = $2 RETURNING ${COLONNES_CONTACT}`,
        [contactId, id, ...set.valeurs],
      );
      if (modif.principal) await unSeulPrincipal(db, id, contactId);
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "contact_client",
        entiteId: contactId,
        details: {
          client_id: id,
          avant: choisir(avant, champs),
          apres: choisir(r.rows[0], champs),
        },
      });
      return r.rows[0];
    });
  });

  app.delete("/clients/:id/contacts/:contactId", async (request, reply) => {
    const auth = exiger(request, "clients.ecrire");
    const { id, contactId } = paramsContact.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `DELETE FROM contacts_client WHERE id = $1 AND client_id = $2 RETURNING ${COLONNES_CONTACT}`,
        [contactId, id],
      );
      if (!r.rows[0]) throw introuvable("Contact");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "contact_client",
        entiteId: contactId,
        details: { client_id: id, avant: choisir(r.rows[0], CHAMPS_CONTACT) },
      });
    });
    return reply.status(204).send();
  });
};
