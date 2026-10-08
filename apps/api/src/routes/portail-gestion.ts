import type { FastifyPluginAsync } from "fastify";
import {
  estRoleClient,
  portailClientQuerySchema,
  portailInvitationAcceptationSchema,
  portailInvitationCreationSchema,
  portailParametresModificationSchema,
  portailPartagesSchema,
  ROLE_LIBELLES,
  ROLES_CLIENT,
  TYPES_DOCUMENT_PARTAGEABLES,
  type Role,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig, type Trousseau } from "../auth/chiffrement.js";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { creerSession, poserCookieSession } from "../auth/ouvrir-session.js";
import { hashPassword } from "../auth/password.js";
import { hacherJeton, nouveauJeton } from "../auth/session.js";
import { traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  filtreVisibilite,
  modifieToutesLesMissions,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { envoyerOuDifferer } from "../notifications/file-email.js";
import { associesActifs, notifierAvecEmailEnFile } from "../notifications/notifier.js";
import { DUREE_INVITATION_JOURS } from "./utilisateurs.js";

/*
 * Portail client, côté CABINET (SOC-09), sous /api/portail :
 *
 * - invitations (POST, DELETE) : « portail.gerer » (associé, directeur et chef
 *   de mission) ; un chef de mission ne gère que les clients dont il dirige
 *   (directeur ou chef) une mission ; client ACTIF ; rôles client SEULEMENT
 *   (schéma strict + CHECK en base) ; jeton haché, 7 jours ; e-mail envoyé
 *   après validation (repris par la file chiffrée en cas d'échec) ; une
 *   invitation interne ou d'un autre client en attente pour l'e-mail : 409 ;
 *   alerte de sécurité de tous les associés à chaque invitation ;
 * - acceptation (POST /invitations/accepter, publique comme l'acceptation
 *   interne) : resoudre_invitation_portail (auteur encore habilité pour ce
 *   client, migration 0112) ; les rôles et le client viennent de la base,
 *   jamais du corps ; compte rattaché au client ;
 * - utilisateurs du portail d'un client : liste, désactivation (sessions
 *   fermées), réactivation ;
 * - partages : GET/PUT par client, remplacement des partages des missions
 *   que l'utilisateur gère (les autres restent intacts) ; par défaut rien ;
 * - politique 2FA du portail : lecture (portail.gerer), modification
 *   (cabinet.gerer + mot de passe et second facteur, alerte des associés).
 */

/**
 * Plafond des listes de gestion (utilisateurs et invitations d'un client) ; au-delà, la réponse
 * porte `tronque: true` (pas de pagination par curseur : dette connue, CODING_STANDARDS §10).
 */
const MAX_LISTE = 500;

const invitationInvalide = () =>
  new AppError(400, "INVITATION_INVALIDE", "Invitation invalide, expirée ou déjà utilisée.");

interface ClientGere {
  id: string;
  raison_sociale: string;
  actif: boolean;
}

/**
 * Client du cabinet que l'utilisateur gère sur le portail : 404 s'il
 * n'existe pas (RLS : autre cabinet compris) ; 403 pour un utilisateur sans
 * « mission.modifier_toutes » qui ne dirige aucune mission de ce client.
 */
async function exigerClientGere(db: Db, auth: Auth, clientId: string): Promise<ClientGere> {
  const r = await db.query("SELECT id, raison_sociale, actif FROM clients WHERE id = $1", [
    clientId,
  ]);
  const client = r.rows[0] as ClientGere | undefined;
  if (!client) throw introuvable("Client");
  if (!modifieToutesLesMissions(auth)) {
    const m = await db.query(
      "SELECT 1 FROM missions WHERE client_id = $1 AND (directeur_id = $2 OR chef_id = $2) LIMIT 1",
      [clientId, auth.utilisateurId],
    );
    if (!m.rowCount) throw interdit();
  }
  return client;
}

/** Missions du client que l'utilisateur peut partager (toutes, ou celles qu'il dirige). */
async function missionsGerees(db: Db, auth: Auth, clientId: string): Promise<Set<string>> {
  const r = await db.query(
    `SELECT id FROM missions
     WHERE client_id = $1 AND ($2::boolean OR directeur_id = $3 OR chef_id = $3)`,
    [clientId, modifieToutesLesMissions(auth), auth.utilisateurId],
  );
  return new Set(r.rows.map((x) => x.id as string));
}

/** Partages d'un client, limités aux missions VISIBLES de l'utilisateur. */
async function lirePartages(db: Db, auth: Auth, client: ClientGere) {
  const missions = await db.query(
    `SELECT p.mission_id, m.intitule, m.statut, p.jalons, p.factures, p.partage_le,
       ($2::boolean OR m.directeur_id = $3 OR m.chef_id = $3) AS gerable
     FROM portail_partages p JOIN missions m ON m.id = p.mission_id
     WHERE p.client_id = $1 AND p.document_id IS NULL AND ${filtreVisibilite(4, 3)}
     ORDER BY lower(m.intitule), m.id`,
    [client.id, modifieToutesLesMissions(auth), auth.utilisateurId, voitToutesLesMissions(auth)],
  );
  const documents = await db.query(
    `SELECT p.document_id, p.mission_id, d.type, d.nom, d.version, p.partage_le
     FROM portail_partages p JOIN missions m ON m.id = p.mission_id
     JOIN mission_documents d ON d.id = p.document_id
     WHERE p.client_id = $1 AND p.document_id IS NOT NULL AND ${filtreVisibilite(3, 2)}
     ORDER BY d.type, lower(d.nom), d.version DESC, d.id`,
    [client.id, auth.utilisateurId, voitToutesLesMissions(auth)],
  );
  const contact = await db.query(
    `SELECT u.id, u.nom FROM portail_clients pc JOIN utilisateurs u ON u.id = pc.contact_principal_id
     WHERE pc.client_id = $1`,
    [client.id],
  );
  return {
    client: { id: client.id, raison_sociale: client.raison_sociale, actif: client.actif },
    contact_principal: contact.rows[0] ?? null,
    missions: missions.rows,
    documents: documents.rows,
  };
}

/**
 * Invitations encore en attente pour cet e-mail. Une invitation INTERNE (au
 * cabinet) ou au portail d'un AUTRE client n'est jamais annulée en silence
 * (409 : la révoquer d'abord) ; celles du même client sont remplacées.
 */
async function remplacerInvitationsEnAttente(db: Db, email: string, clientId: string) {
  const r = await db.query(
    `SELECT client_id FROM invitations
     WHERE lower(email) = $1 AND acceptee_le IS NULL AND expire_le > now() FOR UPDATE`,
    [email],
  );
  const enAttente = r.rows.map((x) => x.client_id as string | null);
  if (enAttente.includes(null)) {
    throw conflit(
      "Une invitation au cabinet est en attente pour cet e-mail : révoquez-la d'abord.",
    );
  }
  if (enAttente.some((c) => c !== clientId)) {
    throw conflit(
      "Une invitation au portail d'un autre client est en attente pour cet e-mail : révoquez-la d'abord.",
    );
  }
  await db.query(
    `UPDATE invitations SET expire_le = now()
     WHERE lower(email) = $1 AND client_id = $2 AND acceptee_le IS NULL AND expire_le > now()`,
    [email, clientId],
  );
}

/**
 * Alerte de sécurité (in-app et e-mail en file) de tous les associés actifs :
 * une invitation acceptée ouvre un accès DURABLE au portail, qui survit au
 * départ de son auteur ; les associés peuvent la révoquer avant acceptation.
 */
async function alerterAssociesInvitation(
  db: Db,
  trousseau: Trousseau,
  auth: Auth,
  invitation: { email: string; roles: readonly Role[]; client: ClientGere },
) {
  const { email, roles, client } = invitation;
  for (const id of await associesActifs(db)) {
    await notifierAvecEmailEnFile(db, trousseau, {
      cabinetId: auth.cabinetId,
      destinataireId: id,
      type: "securite_invitation_portail",
      titre: `Invitation au portail client : ${client.raison_sociale}`,
      corps: [
        `${auth.nom} a invité ${email} au portail client de « ${client.raison_sociale} »`,
        `(rôles : ${roles.map((r) => ROLE_LIBELLES[r]).join(", ")}).`,
        "Une fois acceptée, cette personne garde son accès jusqu'à sa désactivation.",
        "Si cette invitation n'est pas attendue, révoquez-la et vérifiez le journal d'audit.",
      ].join("\n"),
      lien: `/clients/${client.id}`,
    });
  }
}

export const routesPortailGestion: FastifyPluginAsync = async (app) => {
  const identite = serviceIdentite(app);

  // --- Invitations -------------------------------------------------------------

  app.post("/invitations", async (request, reply) => {
    const auth = exiger(request, "portail.gerer");
    const { email, client_id, roles } = portailInvitationCreationSchema.parse(request.body);
    const jeton = nouveauJeton();
    const { invitation, nomCabinet } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const client = await exigerClientGere(db, auth, client_id);
      if (!client.actif) throw conflit("Ce client est archivé : il n'a pas accès au portail.");
      const existe = await db.query("SELECT 1 FROM utilisateurs WHERE lower(email) = $1", [email]);
      if (existe.rowCount)
        throw conflit("Un compte du cabinet ou du portail utilise déjà cet e-mail.");
      await remplacerInvitationsEnAttente(db, email, client_id);
      const r = await db.query(
        `INSERT INTO invitations (cabinet_id, email, roles, jeton_hash, expire_le, invite_par, client_id)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7)
         RETURNING id, email, roles, client_id, expire_le, cree_le`,
        [
          auth.cabinetId,
          email,
          roles,
          hacherJeton(jeton),
          DUREE_INVITATION_JOURS,
          auth.utilisateurId,
          client_id,
        ],
      );
      const cabinet = await db.query("SELECT nom FROM cabinets WHERE id = $1", [auth.cabinetId]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "invitation_portail",
        entiteId: r.rows[0].id,
        details: { email, roles, client_id },
      });
      await alerterAssociesInvitation(db, identite.trousseau, auth, { email, roles, client });
      return { invitation: r.rows[0], nomCabinet: cabinet.rows[0].nom as string };
    });
    // Après validation, sans attendre le SMTP ; en cas d'échec, reprise par la file chiffrée.
    void envoyerOuDifferer({
      database: app.db,
      mailer: app.mailer,
      trousseau: trousseauDepuisConfig(app.config),
      cabinetId: auth.cabinetId,
      journal: (m) => request.log.warn(m),
      message: {
        a: email,
        sujet: `Invitation au portail client de ${nomCabinet} sur MissionPilot`,
        texte: [
          `${auth.nom} vous invite à suivre vos missions avec ${nomCabinet} sur le portail client MissionPilot`,
          `(rôles : ${roles.map((r) => ROLE_LIBELLES[r]).join(", ")}).`,
          "",
          "Pour créer votre accès, ouvrez ce lien :",
          // Jeton dans le fragment : ni envoyé au serveur web, ni journalisé.
          `${app.config.WEB_ORIGIN}/portail/invitation#jeton=${jeton}`,
          "",
          `Ce lien expire dans ${DUREE_INVITATION_JOURS} jours.`,
        ].join("\n"),
      },
    });
    reply.status(201);
    return invitation;
  });

  app.delete("/invitations/:id", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT client_id FROM invitations WHERE id = $1 AND client_id IS NOT NULL
           AND acceptee_le IS NULL AND expire_le > now() FOR UPDATE`,
        [id],
      );
      if (!r.rows[0]) throw introuvable("Invitation");
      await exigerClientGere(db, auth, r.rows[0].client_id as string);
      await db.query("UPDATE invitations SET expire_le = now() WHERE id = $1", [id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "revocation",
        entite: "invitation_portail",
        entiteId: id,
        details: { client_id: r.rows[0].client_id },
      });
      return { ok: true };
    });
  });

  /**
   * Route PUBLIQUE (comme POST /api/invitations/accepter) : le jeton fait foi.
   * Rôles et client lus en base (resoudre_invitation_portail) ; consommation
   * atomique ; compte à rôles client rattaché au client (CHECK et
   * déclencheurs : jamais de rôle interne).
   */
  app.post("/invitations/accepter", async (request, reply) => {
    const { jeton, nom, mot_de_passe } = portailInvitationAcceptationSchema.parse(request.body);
    const invitation = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM resoudre_invitation_portail($1)", [
        hacherJeton(jeton),
      ]);
      return r.rows[0] as
        | {
            invitation_id: string;
            cabinet_id: string;
            email: string;
            roles: Role[];
            client_id: string;
          }
        | undefined;
    });
    if (!invitation || invitation.roles.length === 0 || !invitation.roles.every(estRoleClient)) {
      throw invitationInvalide();
    }
    const motDePasseHash = await hashPassword(mot_de_passe);
    const { utilisateurId, jetonSession } = await app.db.withTenant(
      invitation.cabinet_id,
      async (db) => {
        const consommee = await db.query(
          `UPDATE invitations SET acceptee_le = now()
           WHERE id = $1 AND client_id = $2 AND acceptee_le IS NULL AND expire_le > now()
           RETURNING invite_par`,
          [invitation.invitation_id, invitation.client_id],
        );
        if (!consommee.rowCount) throw invitationInvalide();
        const cree = await traduireErreursPg(
          db.query(
            `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [invitation.cabinet_id, invitation.email, nom, invitation.roles, motDePasseHash],
          ),
          { "*": "Un compte existe déjà avec cet e-mail." },
        );
        const id = cree.rows[0].id as string;
        await db.query(
          `INSERT INTO utilisateurs_portail (utilisateur_id, cabinet_id, client_id, invitation_id, invite_par)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            invitation.cabinet_id,
            invitation.client_id,
            invitation.invitation_id,
            consommee.rows[0].invite_par,
          ],
        );
        await journaliser(db, {
          cabinetId: invitation.cabinet_id,
          utilisateurId: id,
          action: "acceptation",
          entite: "invitation_portail",
          entiteId: invitation.invitation_id,
          details: { utilisateur_id: id, roles: invitation.roles, client_id: invitation.client_id },
        });
        return {
          utilisateurId: id,
          jetonSession: await creerSession(db, invitation.cabinet_id, id),
        };
      },
    );
    poserCookieSession(reply, app.config, jetonSession);
    reply.status(201);
    return {
      utilisateur: { id: utilisateurId, email: invitation.email, nom, roles: invitation.roles },
    };
  });

  // --- Utilisateurs du portail d'un client --------------------------------------

  app.get("/utilisateurs", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { client_id } = portailClientQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerClientGere(db, auth, client_id);
      const u = await db.query(
        `SELECT u.id, u.nom, u.email, u.roles, up.statut, up.cree_le,
           EXISTS (SELECT 1 FROM utilisateurs_2fa t
                   WHERE t.utilisateur_id = u.id AND t.active_le IS NOT NULL) AS tfa_active
         FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
         WHERE up.client_id = $1 ORDER BY lower(u.nom), u.id LIMIT $2`,
        [client_id, MAX_LISTE + 1],
      );
      const i = await db.query(
        `SELECT id, email, roles, expire_le, cree_le FROM invitations
         WHERE client_id = $1 AND acceptee_le IS NULL AND expire_le > now()
         ORDER BY cree_le DESC, id LIMIT $2`,
        [client_id, MAX_LISTE + 1],
      );
      // MAX_LISTE + 1 lignes lues : la troncature n'est plus silencieuse (pas de curseur : dette).
      return {
        utilisateurs: u.rows.slice(0, MAX_LISTE),
        invitations: i.rows.slice(0, MAX_LISTE),
        tronque: u.rows.length > MAX_LISTE || i.rows.length > MAX_LISTE,
      };
    });
  });

  async function changerStatut(auth: Auth, id: string, statut: "actif" | "desactive") {
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT client_id, statut FROM utilisateurs_portail WHERE utilisateur_id = $1 FOR UPDATE",
        [id],
      );
      const rattachement = r.rows[0] as { client_id: string; statut: string } | undefined;
      if (!rattachement) throw introuvable("Utilisateur");
      const client = await exigerClientGere(db, auth, rattachement.client_id);
      if (statut === "actif" && !client.actif) {
        throw conflit("Ce client est archivé : il n'a pas accès au portail.");
      }
      await db.query(
        "UPDATE utilisateurs_portail SET statut = $2, modifie_par = $3 WHERE utilisateur_id = $1",
        [id, statut, auth.utilisateurId],
      );
      await db.query("UPDATE utilisateurs SET actif = $2 WHERE id = $1", [id, statut === "actif"]);
      if (statut === "desactive") {
        await db.query("DELETE FROM sessions WHERE utilisateur_id = $1", [id]);
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: statut === "actif" ? "reactivation" : "desactivation",
        entite: "utilisateur_portail",
        entiteId: id,
        details: { client_id: rattachement.client_id, avant: rattachement.statut, apres: statut },
      });
      return { id, statut };
    });
  }

  /** Désactive un utilisateur du portail : compte inactif et sessions fermées. */
  app.post("/utilisateurs/:id/desactiver", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { id } = paramsId.parse(request.params);
    return changerStatut(auth, id, "desactive");
  });

  app.post("/utilisateurs/:id/reactiver", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { id } = paramsId.parse(request.params);
    return changerStatut(auth, id, "actif");
  });

  // --- Partages -----------------------------------------------------------------

  app.get("/partages", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { client_id } = portailClientQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      lirePartages(db, auth, await exigerClientGere(db, auth, client_id)),
    );
  });

  /**
   * Remplace les partages du client pour les missions que l'utilisateur gère
   * (toutes avec « mission.modifier_toutes », sinon celles qu'il dirige) ;
   * les partages des autres missions restent intacts. Un document n'est
   * partagé que si sa mission l'est, s'il est un livrable ou une lettre de
   * mission, et s'il n'est pas un brouillon IA non validé.
   */
  app.put("/partages", async (request) => {
    const auth = exiger(request, "portail.gerer");
    const { client_id } = portailClientQuerySchema.parse(request.query);
    const corps = portailPartagesSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Verrou du client : deux remplacements simultanés se sérialisent.
      await db.query("SELECT 1 FROM clients WHERE id = $1 FOR UPDATE", [client_id]);
      const client = await exigerClientGere(db, auth, client_id);
      const gerees = await missionsGerees(db, auth, client_id);
      for (const m of corps.missions) {
        if (gerees.has(m.mission_id)) continue;
        const existe = await db.query("SELECT 1 FROM missions WHERE id = $1 AND client_id = $2", [
          m.mission_id,
          client_id,
        ]);
        if (existe.rowCount) throw interdit();
        throw requeteInvalide("Mission inconnue ou d'un autre client.");
      }
      const missionsDemandees = new Set(corps.missions.map((m) => m.mission_id));
      const docs = await db.query(
        "SELECT id, mission_id, type, statut_contenu FROM mission_documents WHERE id = ANY ($1::uuid[])",
        [corps.documents],
      );
      if (docs.rows.length !== corps.documents.length) throw requeteInvalide("Document inconnu.");
      for (const d of docs.rows) {
        if (!missionsDemandees.has(d.mission_id as string)) {
          throw requeteInvalide("Un document n'est partagé que si sa mission l'est.");
        }
        if (!(TYPES_DOCUMENT_PARTAGEABLES as readonly string[]).includes(d.type as string)) {
          throw requeteInvalide("Seuls les livrables et lettres de mission se partagent.");
        }
        if (d.statut_contenu !== null && d.statut_contenu !== "valide") {
          throw requeteInvalide("Un contenu produit par l'IA se partage une fois validé.");
        }
      }
      const perimetre = [...gerees];
      const avant = await db.query(
        `SELECT mission_id, document_id, jalons, factures FROM portail_partages
         WHERE client_id = $1 AND mission_id = ANY ($2::uuid[]) ORDER BY mission_id, document_id`,
        [client_id, perimetre],
      );
      await db.query(
        "DELETE FROM portail_partages WHERE client_id = $1 AND mission_id = ANY ($2::uuid[])",
        [client_id, perimetre],
      );
      for (const m of corps.missions) {
        await db.query(
          `INSERT INTO portail_partages (cabinet_id, client_id, mission_id, jalons, factures, partage_par)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [auth.cabinetId, client_id, m.mission_id, m.jalons, m.factures, auth.utilisateurId],
        );
      }
      for (const d of docs.rows) {
        await db.query(
          `INSERT INTO portail_partages (cabinet_id, client_id, mission_id, document_id, partage_par)
           VALUES ($1, $2, $3, $4, $5)`,
          [auth.cabinetId, client_id, d.mission_id, d.id, auth.utilisateurId],
        );
      }
      if (corps.contact_principal_id !== undefined) {
        if (corps.contact_principal_id !== null) {
          const c = await db.query(
            "SELECT 1 FROM utilisateurs WHERE id = $1 AND actif AND NOT (roles && $2::text[])",
            [corps.contact_principal_id, ROLES_CLIENT],
          );
          if (!c.rowCount)
            throw requeteInvalide("Contact principal : utilisateur du cabinet inconnu.");
        }
        await db.query(
          `INSERT INTO portail_clients (cabinet_id, client_id, contact_principal_id, modifie_par)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (cabinet_id, client_id) DO UPDATE
             SET contact_principal_id = EXCLUDED.contact_principal_id,
                 modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
          [auth.cabinetId, client_id, corps.contact_principal_id, auth.utilisateurId],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "portail_partages",
        entiteId: client_id,
        details: {
          avant: avant.rows,
          apres: {
            missions: corps.missions,
            documents: corps.documents,
            ...(corps.contact_principal_id !== undefined
              ? { contact_principal_id: corps.contact_principal_id }
              : {}),
          },
        },
      });
      return lirePartages(db, auth, client);
    });
  });

  // --- Politique du portail -------------------------------------------------------

  app.get("/parametres", async (request) => {
    const auth = exiger(request, "portail.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT tfa_obligatoire FROM portail_parametres WHERE cabinet_id = $1",
        [auth.cabinetId],
      );
      return { tfa_obligatoire: r.rows[0]?.tfa_obligatoire === true };
    });
  });

  /** Politique 2FA du portail : « cabinet.gerer », mot de passe ET second facteur, alerte des associés. */
  app.put("/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { tfa_obligatoire, ...confirmation } = portailParametresModificationSchema.parse(
      request.body,
    );
    return identite.confirmerIdentite(auth, confirmation, "politique_2fa_portail", async (db) => {
      const avant = await db.query(
        "SELECT tfa_obligatoire FROM portail_parametres WHERE cabinet_id = $1 FOR UPDATE",
        [auth.cabinetId],
      );
      await db.query(
        `INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire, modifie_par)
         VALUES ($1, $2, $3)
         ON CONFLICT (cabinet_id) DO UPDATE
           SET tfa_obligatoire = EXCLUDED.tfa_obligatoire, modifie_par = EXCLUDED.modifie_par,
               modifie_le = now()`,
        [auth.cabinetId, tfa_obligatoire, auth.utilisateurId],
      );
      const valeurAvant = avant.rows[0]?.tfa_obligatoire === true;
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "politique_2fa_portail",
        entiteId: auth.cabinetId,
        details: { avant: valeurAvant, apres: tfa_obligatoire },
      });
      for (const id of await associesActifs(db)) {
        await notifierAvecEmailEnFile(db, identite.trousseau, {
          cabinetId: auth.cabinetId,
          destinataireId: id,
          type: "securite_politique_tfa_portail",
          titre: "Politique de double authentification du portail client modifiée",
          corps: [
            `Modifiée par ${auth.nom}.`,
            `Double authentification obligatoire pour le portail : ${tfa_obligatoire ? "oui" : "non"}.`,
            "Si ce changement n'est pas attendu, vérifiez le journal d'audit.",
          ].join("\n"),
          lien: "/parametres/securite",
        });
      }
      return { tfa_obligatoire };
    });
  });
};
