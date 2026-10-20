import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  ddPortailInvitationParamSchema,
  ddPortailInvitationSchema,
  ddPortailOptionSchema,
  ddPortailParamSchema,
  ddPortailPublicationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible, exigerAussi } from "../due-diligence/acces.js";
import { traduireErreurDueDiligence } from "../due-diligence/erreurs.js";
import { journalDd } from "../due-diligence/journal.js";
import { lireNote } from "../due-diligence/notes.js";
import {
  changerOption,
  comptesDuDossier,
  dossierVerrouille,
  inviterCompte,
  lireOption,
  lirePublication,
  publierNote,
  retirerInvitation,
  retirerPublication,
} from "../due-diligence/portail.js";
import { etatDossier } from "../due-diligence/portail-etat.js";
import { interdit, introuvable } from "../errors.js";

/*
 * Portail investisseur de la due diligence, routes du CABINET (migration 0509), montées sous /api.
 * Aucune n'est ouverte au portail (absentes de `LISTE_BLANCHE_PORTAIL` : 403
 * PORTAIL_ROUTE_INTERDITE pour un compte du portail).
 *
 * - Option du cabinet, DÉSACTIVÉE par défaut : lecture `dd.portail.gerer` ou
 *   `dd.portail.configurer` ; changement `dd.portail.configurer` (associé seul).
 * - Comptes, invitations, publications, état : `dd.portail.gerer` ET `dd.lire`, plus la visibilité
 *   de la mission (404 au même libellé que l'inexistant). Inviter et publier : mission verrouillée
 *   et non clôturée (409 MISSION_CLOTUREE) ; retirer une invitation ou une publication : mission
 *   verrouillée, même clôturée (réduire l'exposition n'est jamais bloqué).
 * - Ajout seul : aucun PUT ni DELETE ; un retrait est un événement (POST …/retrait).
 * - Chaque écriture est journalisée dans sa transaction : identifiants, versions et comptes
 *   seulement, jamais un nom, un titre ni une synthèse.
 */

export const routesDueDiligencePortail: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurDueDiligence(error);
  });

  app.get("/dd/portail/option", async (request) => {
    const auth = exiger(request);
    if (
      !aPermission(auth.roles, "dd.portail.gerer") &&
      !aPermission(auth.roles, "dd.portail.configurer")
    ) {
      throw interdit();
    }
    return app.db.withTenant(auth.cabinetId, (db) => lireOption(db, auth.cabinetId));
  });

  app.post("/dd/portail/option", async (request) => {
    const auth = exiger(request, "dd.portail.configurer");
    const { actif } = ddPortailOptionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { option, change } = await changerOption(db, auth, actif);
      if (change) {
        await journalDd(db, auth, "dd_portail_option_modifiee", "cabinet", auth.cabinetId, {
          actif,
        });
      }
      return option;
    });
  });

  app.get("/dd/dossiers/:id/portail", async (request) => {
    const auth = exiger(request, "dd.portail.gerer");
    exigerAussi(auth, "dd.lire");
    const { id } = ddPortailParamSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, false);
      return etatDossier(db, auth.cabinetId, dossier);
    });
  });

  app.get("/dd/dossiers/:id/portail/comptes", async (request) => {
    const auth = exiger(request, "dd.portail.gerer");
    exigerAussi(auth, "dd.lire");
    const { id } = ddPortailParamSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, false);
      return { elements: await comptesDuDossier(db, dossier) };
    });
  });

  app.post("/dd/dossiers/:id/portail/invitations", async (request, reply) => {
    const auth = exiger(request, "dd.portail.gerer");
    exigerAussi(auth, "dd.lire");
    const { id } = ddPortailParamSchema.parse(request.params);
    const { utilisateur_id } = ddPortailInvitationSchema.parse(request.body);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const r = await inviterCompte(db, auth, dossier, utilisateur_id);
      await journalDd(db, auth, "dd_portail_compte_invite", "dd_dossier", id, { utilisateur_id });
      return r;
    });
    reply.status(201);
    return resultat;
  });

  app.post(
    "/dd/dossiers/:id/portail/invitations/:utilisateurId/retrait",
    async (request, reply) => {
      const auth = exiger(request, "dd.portail.gerer");
      exigerAussi(auth, "dd.lire");
      const { id, utilisateurId } = ddPortailInvitationParamSchema.parse(request.params);
      await app.db.withTenant(auth.cabinetId, async (db) => {
        const { dossier } = await dossierVerrouille(db, auth, id);
        await retirerInvitation(db, auth, dossier, utilisateurId);
        await journalDd(db, auth, "dd_portail_invitation_retiree", "dd_dossier", id, {
          utilisateur_id: utilisateurId,
        });
      });
      reply.status(201);
      return { ok: true };
    },
  );

  app.post("/dd/notes/:id/portail/publications", async (request, reply) => {
    const auth = exiger(request, "dd.portail.gerer");
    exigerAussi(auth, "dd.lire");
    const { id } = ddPortailParamSchema.parse(request.params);
    const corps = ddPortailPublicationSchema.parse(request.body);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const note = await lireNote(db, id);
      await dossierAccessible(db, auth, note.dossier_id, true, "Note");
      const p = await publierNote(db, auth, note, corps);
      await journalDd(db, auth, "dd_portail_note_publiee", "dd_portail_publication", p.id, {
        note_id: id,
        version: corps.version,
        pieces: p.pieces,
      });
      return { id: p.id };
    });
    reply.status(201);
    return resultat;
  });

  app.post("/dd/portail/publications/:id/retrait", async (request, reply) => {
    const auth = exiger(request, "dd.portail.gerer");
    exigerAussi(auth, "dd.lire");
    const { id } = ddPortailParamSchema.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const lue = await lirePublication(db, id);
      if (!lue) throw introuvable("Publication");
      await dossierVerrouille(db, auth, lue.dossier_id, "Publication");
      // Relue sous le verrou de la mission : un retrait concurrent est vu.
      const publication = (await lirePublication(db, id)) ?? lue;
      await retirerPublication(db, auth, publication);
      await journalDd(db, auth, "dd_portail_publication_retiree", "dd_portail_publication", id, {
        note_id: publication.note_id,
      });
    });
    reply.status(201);
    return { ok: true };
  });
};
