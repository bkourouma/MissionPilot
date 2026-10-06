import type { FastifyPluginAsync } from "fastify";
import {
  invitationAcceptationSchema,
  invitationCreationSchema,
  ROLE_LIBELLES,
  utilisateurModificationSchema,
  type Role,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import { supprimerTfa } from "../auth/double-authentification.js";
import { creerSession, poserCookieSession } from "../auth/ouvrir-session.js";
import { hashPassword } from "../auth/password.js";
import { hacherJeton, nouveauJeton } from "../auth/session.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { envoyerOuDifferer } from "../notifications/file-email.js";

const COLONNES = "id, email, nom, roles, actif, cree_le";
const COLONNES_INVITATION = "id, email, roles, expire_le, acceptee_le, cree_le";
export const DUREE_INVITATION_JOURS = 7;

interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  roles: Role[];
  actif: boolean;
}

const invitationInvalide = () =>
  new AppError(400, "INVITATION_INVALIDE", "Invitation invalide, expirée ou déjà utilisée.");

const estAssocieActif = (u: Pick<Utilisateur, "actif" | "roles">) =>
  u.actif && u.roles.includes("associe");

/** Refuse de retirer le dernier associé actif (le cabinet deviendrait ingérable). */
async function verifierDernierAssocie(db: Db, avant: Utilisateur, apres: Utilisateur) {
  if (!estAssocieActif(avant) || estAssocieActif(apres)) return;
  const autres = await db.query(
    "SELECT 1 FROM utilisateurs WHERE id <> $1 AND actif AND 'associe' = ANY (roles) LIMIT 1",
    [avant.id],
  );
  if (!autres.rowCount) {
    throw new AppError(409, "DERNIER_ASSOCIE", "Le cabinet doit garder au moins un associé actif.");
  }
}

export const routesUtilisateurs: FastifyPluginAsync = async (app) => {
  app.get("/utilisateurs", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT u.id, u.email, u.nom, u.roles, u.actif, u.cree_le,
           EXISTS (SELECT 1 FROM utilisateurs_2fa t
                   WHERE t.utilisateur_id = u.id AND t.active_le IS NOT NULL) AS tfa_active
         FROM utilisateurs u ORDER BY lower(u.nom), u.id`,
      );
      return { elements: r.rows };
    });
  });

  app.patch("/utilisateurs/:id", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    const modif = utilisateurModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Verrou du cabinet : sérialise les changements de rôles (règle du dernier associé).
      await db.query("SELECT 1 FROM cabinets WHERE id = $1 FOR UPDATE", [auth.cabinetId]);
      const avant = (await db.query(`SELECT ${COLONNES} FROM utilisateurs WHERE id = $1`, [id]))
        .rows[0] as Utilisateur | undefined;
      if (!avant) throw introuvable("Utilisateur");
      const apres: Utilisateur = {
        ...avant,
        nom: modif.nom ?? avant.nom,
        roles: modif.roles ?? avant.roles,
        actif: modif.actif ?? avant.actif,
      };
      await verifierDernierAssocie(db, avant, apres);
      const r = await db.query(
        `UPDATE utilisateurs SET nom = $2, roles = $3, actif = $4 WHERE id = $1 RETURNING ${COLONNES}`,
        [id, apres.nom, apres.roles, apres.actif],
      );
      if (avant.actif && !apres.actif) {
        await db.query("DELETE FROM sessions WHERE utilisateur_id = $1", [id]);
      }
      // Un invitant désactivé ou rétrogradé ne laisse pas d'invitations valables derrière lui.
      if (estAssocieActif(avant) && !estAssocieActif(apres)) {
        await db.query(
          `UPDATE invitations SET expire_le = now()
           WHERE invite_par = $1 AND acceptee_le IS NULL AND expire_le > now()`,
          [id],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "utilisateur",
        entiteId: id,
        details: {
          avant: { nom: avant.nom, roles: avant.roles, actif: avant.actif },
          apres: { nom: apres.nom, roles: apres.roles, actif: apres.actif },
        },
      });
      return r.rows[0];
    });
  });

  /**
   * Réinitialisation de la 2FA d'un autre utilisateur (appareil perdu) par un
   * associé : secret, codes de secours et défis supprimés, sessions fermées,
   * action journalisée. Pour soi-même : /api/auth/2fa/desactiver (mot de passe
   * et second facteur exigés).
   */
  app.post("/utilisateurs/:id/2fa/reinitialiser", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    if (id === auth.utilisateurId) {
      throw new AppError(
        400,
        "REINITIALISATION_SOI",
        "Pour votre propre compte, désactivez la double authentification depuis votre profil.",
      );
    }
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const cible = await db.query("SELECT id FROM utilisateurs WHERE id = $1 FOR UPDATE", [id]);
      if (!cible.rowCount) throw introuvable("Utilisateur");
      const avait = await supprimerTfa(db, id);
      await db.query("DELETE FROM sessions WHERE utilisateur_id = $1", [id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "2fa_reinitialisation",
        entite: "utilisateur",
        entiteId: id,
        details: { tfa_etait_configuree: avait },
      });
      return { ok: true };
    });
  });

  app.get("/invitations", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_INVITATION} FROM invitations
         WHERE acceptee_le IS NULL AND expire_le > now() ORDER BY cree_le DESC`,
      );
      return { elements: r.rows };
    });
  });

  app.delete("/invitations/:id", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `UPDATE invitations SET expire_le = now()
         WHERE id = $1 AND acceptee_le IS NULL AND expire_le > now() RETURNING id`,
        [id],
      );
      if (!r.rowCount) throw introuvable("Invitation");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "revocation",
        entite: "invitation",
        entiteId: id,
      });
      return { ok: true };
    });
  });

  app.post("/invitations", async (request, reply) => {
    const auth = exiger(request, "cabinet.gerer");
    const { email, roles } = invitationCreationSchema.parse(request.body);
    const jeton = nouveauJeton();
    const { invitation, nomCabinet } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const existe = await db.query("SELECT 1 FROM utilisateurs WHERE lower(email) = $1", [email]);
      if (existe.rowCount) throw conflit("Un utilisateur du cabinet utilise déjà cet e-mail.");
      // Une nouvelle invitation remplace celles encore en attente pour cet e-mail.
      await db.query(
        `UPDATE invitations SET expire_le = now()
         WHERE lower(email) = $1 AND acceptee_le IS NULL AND expire_le > now()`,
        [email],
      );
      const r = await db.query(
        `INSERT INTO invitations (cabinet_id, email, roles, jeton_hash, expire_le, invite_par)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)
         RETURNING ${COLONNES_INVITATION}`,
        [
          auth.cabinetId,
          email,
          roles,
          hacherJeton(jeton),
          DUREE_INVITATION_JOURS,
          auth.utilisateurId,
        ],
      );
      const cabinet = await db.query("SELECT nom FROM cabinets WHERE id = $1", [auth.cabinetId]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "invitation",
        entiteId: r.rows[0].id,
        details: { email, roles },
      });
      return { invitation: r.rows[0], nomCabinet: cabinet.rows[0].nom as string };
    });
    // Après validation : en cas d'échec SMTP, l'e-mail est repris par la file de tâches.
    await envoyerOuDifferer({
      database: app.db,
      mailer: app.mailer,
      trousseau: trousseauDepuisConfig(app.config),
      cabinetId: auth.cabinetId,
      journal: (m) => request.log.warn(m),
      message: {
        a: email,
        sujet: `Invitation à rejoindre ${nomCabinet} sur MissionPilot`,
        texte: [
          `${auth.nom} vous invite à rejoindre ${nomCabinet} sur MissionPilot`,
          `(rôles : ${roles.map((r) => ROLE_LIBELLES[r]).join(", ")}).`,
          "",
          "Pour créer votre compte, ouvrez ce lien :",
          // Le jeton est dans le fragment : il n'est ni envoyé au serveur web, ni journalisé.
          `${app.config.WEB_ORIGIN}/invitation#jeton=${jeton}`,
          "",
          `Ce lien expire dans ${DUREE_INVITATION_JOURS} jours.`,
        ].join("\n"),
      },
    });
    reply.status(201);
    return invitation;
  });

  app.post("/invitations/accepter", async (request, reply) => {
    const { jeton, nom, mot_de_passe } = invitationAcceptationSchema.parse(request.body);
    const jetonHash = hacherJeton(jeton);
    const invitation = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM resoudre_invitation($1)", [jetonHash]);
      return r.rows[0] as
        { invitation_id: string; cabinet_id: string; email: string; roles: Role[] } | undefined;
    });
    if (!invitation) throw invitationInvalide();
    const motDePasseHash = await hashPassword(mot_de_passe);

    const { utilisateurId, jetonSession } = await app.db.withTenant(
      invitation.cabinet_id,
      async (db) => {
        // Consommation atomique : deux acceptations simultanées ne créent qu'un compte.
        const consommee = await db.query(
          `UPDATE invitations SET acceptee_le = now()
           WHERE id = $1 AND acceptee_le IS NULL AND expire_le > now() RETURNING id`,
          [invitation.invitation_id],
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
        await journaliser(db, {
          cabinetId: invitation.cabinet_id,
          utilisateurId: id,
          action: "acceptation",
          entite: "invitation",
          entiteId: invitation.invitation_id,
          details: { utilisateur_id: id, roles: invitation.roles },
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
};
