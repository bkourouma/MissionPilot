import type { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import {
  fichierTelechargementQuerySchema,
  portailListeQuerySchema,
  salleAcceptationSchema,
  salleDemandeCreationSchema,
  salleDemandeModificationSchema,
  salleDemandeParamsSchema,
  salleDepotParamsSchema,
  salleModeleCreationSchema,
  salleModeleModificationSchema,
  salleModelesQuerySchema,
  sallePieceModificationSchema,
  sallePieceParamsSchema,
  sallePieceSchema,
  salleRattachementSchema,
  salleRejetSchema,
  salleRelanceSchema,
  TYPES_FICHIER_EN_LIGNE,
  type TypeFichier,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paramsId } from "../http/outils.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import {
  avecPortail,
  exigerPortail,
  introuvablePortail,
  journaliserPortail,
} from "../portail/acces.js";
import { suiteDepotPortail } from "../salle-mission/accuses.js";
import { accepterPiece, rejeterPiece, verserAuDossier } from "../salle-mission/decisions.js";
import {
  ajouterPiece,
  cloreDemande,
  creerDemande,
  envoyerDemande,
  modifierDemande,
  modifierPiece,
  supprimerDemande,
  supprimerPiece,
} from "../salle-mission/demandes.js";
import {
  depotDejaRecu,
  deposerDepuisPortail,
  deposerParLeCabinet,
  exigerDepotPossible,
  lirePieceDeposable,
  retirerDepot,
  verifierPlafondsDepots,
} from "../salle-mission/depots.js";
import {
  exigerDemande,
  exigerMissionSalle,
  exigerPiece,
  salleDeMission,
  vueDemande,
} from "../salle-mission/donnees.js";
import { traduireErreurSalle } from "../salle-mission/erreurs.js";
import { creerModele, listerModeles, modifierModele } from "../salle-mission/modeles.js";
import { maDemande, mesDemandes } from "../salle-mission/portail.js";
import { relancerManuellement } from "../salle-mission/relances.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { contentDisposition } from "../stockage/nom.js";
import { avecPlaceAnalyse, gardeTailleMultipart } from "./fichiers.js";

/**
 * CLI-01 : salle de mission (PRD complémentaire §13 ; « document reçu », §8.2).
 *
 * Côté cabinet, sous /api/missions/:id/salle/** et /api/salle/modeles/** : lecture
 * `salle.lire`, écriture `salle.gerer` (verser au dossier : `document.ecrire` en plus), toujours
 * avec la mission VISIBLE (404 sinon, même pour un autre cabinet) et, en écriture (dépôt de
 * l'équipe et retrait d'un dépôt compris), NON clôturée (409). La clôture de la mission clôt ses
 * demandes envoyées (routes/missions.ts, `cloreDemandesDeMission`). Côté client, sous /api/portail/salle/** : `portail.salle.deposer` (dirigeant et
 * contributeur), routes ouvertes une à une dans LISTE_BLANCHE_PORTAIL (portail/garde.ts).
 *
 * Fichiers reçus (SECURITY.md §8) : taille annoncée refusée avant l'authentification
 * (`gardeTailleMultipart`), droits contrôlés AVANT la lecture du corps, une seule partie
 * multipart, type détecté par le contenu, place prise dans le sémaphore de réception
 * (`avecPlaceAnalyse`) pour la seule analyse. Le multipart n'est enregistré QUE dans ce plugin.
 */
export const routesSalleMission: FastifyPluginAsync = async (app) => {
  const tailleMax = app.config.FICHIER_TAILLE_MAX_OCTETS;
  await app.register(multipart, {
    limits: {
      fileSize: tailleMax,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 50,
      headerPairs: 50,
    },
    throwFileSizeLimit: true,
  });
  app.setErrorHandler(async (error) => {
    throw traduireErreurSalle(error);
  });
  const gardeTaille = gardeTailleMultipart(
    tailleMax,
    () =>
      new AppError(
        413,
        "FICHIER_TROP_VOLUMINEUX",
        `Fichier trop volumineux : ${Math.floor(tailleMax / (1024 * 1024))} Mo au plus.`,
      ),
  );
  const emails = (n: readonly (NotificationCreee | null)[]) =>
    envoyerEmails(app.mailer, n, (m) => app.log.warn(m));

  // ----- Modèles du cabinet --------------------------------------------------------------

  app.get("/salle/modeles", async (request) => {
    const auth = exiger(request, "salle.lire");
    const q = salleModelesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerModeles(db, { methodeId: q.methode_id, archives: q.archives === "true" }),
    );
  });

  app.post("/salle/modeles", async (request, reply) => {
    const auth = exiger(request, "salle.gerer");
    const corps = salleModeleCreationSchema.parse(request.body);
    const modele = await app.db.withTenant(auth.cabinetId, (db) => creerModele(db, auth, corps));
    reply.status(201);
    return modele;
  });

  app.patch("/salle/modeles/:id", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = salleModeleModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierModele(db, auth, id, corps));
  });

  // ----- Salle d'une mission (cabinet) ----------------------------------------------------

  app.get("/missions/:id/salle", async (request) => {
    const auth = exiger(request, "salle.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      salleDeMission(db, await exigerMissionSalle(db, auth, id)),
    );
  });

  app.post("/missions/:id/salle/demandes", async (request, reply) => {
    const auth = exiger(request, "salle.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = salleDemandeCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionSalle(db, auth, id, true);
      return vueDemande(db, await creerDemande(db, auth, mission, corps));
    });
    reply.status(201);
    return vue;
  });

  app.get("/missions/:id/salle/demandes/:demandeId", async (request) => {
    const auth = exiger(request, "salle.lire");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id);
      return vueDemande(db, await exigerDemande(db, id, demandeId));
    });
  });

  app.patch("/missions/:id/salle/demandes/:demandeId", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    const corps = salleDemandeModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      await modifierDemande(db, auth, await exigerDemande(db, id, demandeId, true), corps);
      return vueDemande(db, await exigerDemande(db, id, demandeId));
    });
  });

  app.delete("/missions/:id/salle/demandes/:demandeId", async (request, reply) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      await supprimerDemande(db, auth, await exigerDemande(db, id, demandeId, true));
    });
    return reply.status(204).send();
  });

  app.post("/missions/:id/salle/demandes/:demandeId/pieces", async (request, reply) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    const corps = sallePieceSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      await ajouterPiece(db, auth, await exigerDemande(db, id, demandeId, true), corps);
      return vueDemande(db, await exigerDemande(db, id, demandeId));
    });
    reply.status(201);
    return vue;
  });

  app.patch("/missions/:id/salle/pieces/:pieceId", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, pieceId } = sallePieceParamsSchema.parse(request.params);
    const corps = sallePieceModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      const { demande } = await exigerPiece(db, id, pieceId);
      const verrouillee = await exigerDemande(db, id, demande.id, true);
      await modifierPiece(db, auth, verrouillee, pieceId, corps);
      return vueDemande(db, await exigerDemande(db, id, demande.id));
    });
  });

  app.delete("/missions/:id/salle/pieces/:pieceId", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, pieceId } = sallePieceParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      const { demande } = await exigerPiece(db, id, pieceId);
      await supprimerPiece(db, auth, await exigerDemande(db, id, demande.id, true), pieceId);
      return vueDemande(db, await exigerDemande(db, id, demande.id));
    });
  });

  app.post("/missions/:id/salle/demandes/:demandeId/envoyer", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    const { vue, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      const envoyees = await envoyerDemande(db, auth, await exigerDemande(db, id, demandeId, true));
      return {
        vue: await vueDemande(db, await exigerDemande(db, id, demandeId)),
        notifications: envoyees,
      };
    });
    await emails(notifications);
    return vue;
  });

  app.post("/missions/:id/salle/demandes/:demandeId/cloturer", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      await cloreDemande(db, auth, await exigerDemande(db, id, demandeId, true));
      return vueDemande(db, await exigerDemande(db, id, demandeId));
    });
  });

  app.post("/missions/:id/salle/demandes/:demandeId/relancer", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, demandeId } = salleDemandeParamsSchema.parse(request.params);
    salleRelanceSchema.parse(request.body ?? {});
    const notifications = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      return relancerManuellement(db, auth, await exigerDemande(db, id, demandeId, true));
    });
    await emails(notifications);
    return { relances: notifications.length };
  });

  app.post("/missions/:id/salle/pieces/:pieceId/accepter", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, pieceId } = sallePieceParamsSchema.parse(request.params);
    const corps = salleAcceptationSchema.parse(request.body ?? {});
    const { vue, notification, documentId } = await app.db.withTenant(
      auth.cabinetId,
      async (db) => {
        await exigerMissionSalle(db, auth, id, true);
        const r = await accepterPiece(db, auth, id, pieceId, {
          rattacher: corps.rattacher === true,
          nomDocument: corps.nom_document,
        });
        const { demande } = await exigerPiece(db, id, pieceId);
        return { ...r, vue: await vueDemande(db, demande) };
      },
    );
    await emails([notification]);
    return { ...vue, document_id: documentId };
  });

  app.post("/missions/:id/salle/pieces/:pieceId/rejeter", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, pieceId } = sallePieceParamsSchema.parse(request.params);
    const { motif } = salleRejetSchema.parse(request.body);
    const { vue, notification } = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      const n = await rejeterPiece(db, auth, id, pieceId, motif);
      const { demande } = await exigerPiece(db, id, pieceId);
      return { notification: n, vue: await vueDemande(db, demande) };
    });
    await emails([notification]);
    return vue;
  });

  /** Pièce reçue hors portail, déposée par l'équipe (aucun accusé de réception). */
  app.post(
    "/missions/:id/salle/pieces/:pieceId/depots",
    { onRequest: gardeTaille },
    async (request, reply) => {
      const auth = exiger(request, "salle.gerer");
      const { id, pieceId } = sallePieceParamsSchema.parse(request.params);
      // Droits contrôlés AVANT de lire le corps, puis revérifiés sous verrou.
      await app.db.withTenant(auth.cabinetId, async (db) => {
        await exigerMissionSalle(db, auth, id, true);
        const piece = await lirePieceDeposable(db, pieceId, { missionId: id });
        if (!piece) throw introuvable("Pièce");
        exigerDepotPossible(piece, "cabinet");
        await verifierPlafondsDepots(db, auth, piece, "cabinet");
      });
      const recu = await lireTeleversement(request, tailleMax);
      const r = await avecPlaceAnalyse(auth.cabinetId, () =>
        deposerParLeCabinet(app, auth, id, pieceId, recu),
      );
      reply.status(r.nouveau ? 201 : 200);
      return app.db.withTenant(auth.cabinetId, async (db) => {
        const { demande } = await exigerPiece(db, id, pieceId);
        return { ...(await vueDemande(db, demande)), depot_id: r.depotId, nouveau: r.nouveau };
      });
    },
  );

  /**
   * Retrait par l'équipe d'un dépôt non accepté (fichier déposé à tort) : le fichier est marqué
   * supprimé (ajout seul) et son objet effacé du stockage après validation. Mission modifiable.
   */
  app.delete("/missions/:id/salle/depots/:depotId", async (request) => {
    const auth = exiger(request, "salle.gerer");
    const { id, depotId } = salleDepotParamsSchema.parse(request.params);
    const { retire, vue } = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      const r = await retirerDepot(db, auth, id, depotId);
      const { demande } = await exigerPiece(db, id, r.pieceId);
      return { retire: r, vue: await vueDemande(db, demande) };
    });
    await stockageDe(app.config)
      .supprimer(auth.cabinetId, retire.cleStockage)
      .catch(() => undefined);
    return vue;
  });

  app.post("/missions/:id/salle/depots/:depotId/rattacher", async (request, reply) => {
    const auth = exiger(request, "salle.gerer");
    exiger(request, "document.ecrire");
    const { id, depotId } = salleDepotParamsSchema.parse(request.params);
    const corps = salleRattachementSchema.parse(request.body ?? {});
    const document = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id, true);
      return verserAuDossier(db, auth, id, depotId, corps.nom_document);
    });
    reply.status(201);
    return document;
  });

  app.get("/missions/:id/salle/depots/:depotId/fichier", async (request, reply) => {
    const auth = exiger(request, "salle.lire");
    const { id, depotId } = salleDepotParamsSchema.parse(request.params);
    const q = fichierTelechargementQuerySchema.parse(request.query);
    const f = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionSalle(db, auth, id);
      const r = await db.query(
        `SELECT f.id, f.nom_origine AS nom, f.type_mime, f.taille, f.cle_stockage
         FROM salle_depots x JOIN salle_pieces p ON p.id = x.piece_id
         JOIN fichiers f ON f.id = x.fichier_id
         WHERE x.id = $1 AND p.mission_id = $2
           AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
        [depotId, id],
      );
      const lu = r.rows[0] as
        | { id: string; nom: string; type_mime: string; taille: string; cle_stockage: string }
        | undefined;
      if (!lu) throw introuvable("Fichier");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "telechargement",
        entite: "fichier",
        entiteId: lu.id,
        details: { nom: lu.nom, type_mime: lu.type_mime, salle_depot_id: depotId },
      });
      return lu;
    });
    return envoyerFichier(reply, f, q.affichage === "inline", () =>
      stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage),
    );
  });

  // ----- Portail client --------------------------------------------------------------------

  app.get("/portail/salle/demandes", async (request) => {
    const acces = exigerPortail(request, "portail.salle.deposer");
    const q = portailListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const page = await mesDemandes(db, acces, apres, q.limite);
      await journaliserPortail(db, acces, "portail_lecture", "salle_demandes", null, {
        nombre: page.elements.length,
      });
      return page;
    });
  });

  app.get("/portail/salle/demandes/:id", async (request) => {
    const acces = exigerPortail(request, "portail.salle.deposer");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const vue = await maDemande(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "salle_demande", id);
      return vue;
    });
  });

  /**
   * Dépôt d'une pièce par le client. Réponse : la demande à jour (201, ou 200 pour un rejeu du
   * même fichier). L'accusé de réception (R0) et l'information de l'équipe suivent, hors du
   * contexte du portail, sans rien ajouter à la réponse (salle-mission/accuses.ts).
   */
  app.post(
    "/portail/salle/pieces/:id/depots",
    { onRequest: gardeTaille },
    async (request, reply) => {
      const acces = exigerPortail(request, "portail.salle.deposer");
      const { id } = paramsId.parse(request.params);
      // Droits contrôlés AVANT de lire le corps (même 404 pour inexistant, brouillon, d'autrui).
      await avecPortail(app, acces, async (db) => {
        const piece = await lirePieceDeposable(db, id, { clientId: acces.clientId });
        if (!piece) throw introuvablePortail();
        exigerDepotPossible(piece, "portail");
        await verifierPlafondsDepots(db, acces.auth, piece, "portail");
      });
      const recu = await lireTeleversement(request, tailleMax);
      const rejeu = await avecPortail(app, acces, async (db) => {
        const piece = await lirePieceDeposable(db, id, { clientId: acces.clientId });
        if (!piece) throw introuvablePortail();
        exigerDepotPossible(piece, "portail");
        return depotDejaRecu(db, piece, recu.contenu);
      });
      const r = rejeu
        ? { depotId: rejeu, nouveau: false }
        : await avecPlaceAnalyse(acces.auth.cabinetId, () =>
            deposerDepuisPortail(app, acces, id, recu),
          );
      const vue = await avecPortail(app, acces, async (db) => {
        const demande = await db.query(
          "SELECT demande_id FROM salle_pieces WHERE id = $1 AND client_id = $2",
          [id, acces.clientId],
        );
        if (!demande.rows[0]) throw introuvablePortail();
        return maDemande(db, acces, demande.rows[0].demande_id as string);
      });
      if (r.nouveau) await suiteDepotPortail(app, acces.auth.cabinetId, r.depotId);
      reply.status(r.nouveau ? 201 : 200);
      return { ...vue, depot_id: r.depotId, nouveau: r.nouveau };
    },
  );
};

/** Envoie un fichier du stockage avec les en-têtes de `GET /fichiers/:id` (routes/fichiers.ts). */
async function envoyerFichier(
  reply: FastifyReply,
  f: { nom: string; type_mime: string; taille: string | number },
  enLigneDemande: boolean,
  lire: () => Promise<Readable>,
) {
  let flux;
  try {
    flux = await lire();
  } catch (error) {
    if (error instanceof FichierAbsent) throw introuvable("Fichier");
    throw error;
  }
  const enLigne = enLigneDemande && TYPES_FICHIER_EN_LIGNE.includes(f.type_mime as TypeFichier);
  const texte = f.type_mime === "text/plain" || f.type_mime === "text/csv";
  return reply
    .header("Content-Type", texte ? `${f.type_mime}; charset=utf-8` : f.type_mime)
    .header("Content-Length", String(f.taille))
    .header("Content-Disposition", contentDisposition(f.nom, enLigne ? "inline" : "attachment"))
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", "sandbox; default-src 'none'")
    .header("Cache-Control", "private, no-store")
    .header("Cross-Origin-Resource-Policy", "same-site")
    .header("Referrer-Policy", "no-referrer")
    .send(flux);
}
