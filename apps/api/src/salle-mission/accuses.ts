import type { FastifyInstance } from "fastify";
import { journaliser } from "../audit.js";
import { lireCoupeCircuit } from "../agents/autonomie.js";
import type { Db } from "../db/pool.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { horsContextePortail } from "../portail/contexte.js";
import { nomCabinet } from "./demandes.js";
import { horodatageFr } from "./regles.js";

/*
 * Suite d'un dépôt du client (CLI-01, « document reçu », PRD complémentaire §8.2) :
 *
 * 1. Accusé de réception AUTOMATIQUE au déposant (classe R0 : seule autonomie N4 admise vers le
 *    client, DECISIONS.md du 2026-10-08) : notification doublée d'un e-mail, tracée dans
 *    `salle_accuses` et journalisée (`accuse_reception`, sans auteur : action automatique).
 *    Coupe-circuit N4 du cabinet actif, ou déposant devenu inactif : l'accusé est SUSPENDU,
 *    tracé et journalisé, rien ne part.
 * 2. Information de l'équipe : chef et directeur de la mission (in-app).
 *
 * Traitement INTERNE déclenché par une action du portail, qui ne renvoie rien au client dans la
 * réponse HTTP : il s'exécute APRÈS la transaction du dépôt, hors du contexte RLS du portail
 * (`horsContextePortail`, inventorié par test/portail-contexte.test.ts) parce qu'il lit le
 * coupe-circuit, l'équipe de la mission et écrit des tables interdites au portail. Un échec
 * n'annule pas le dépôt (déjà validé) : il est journalisé par le serveur.
 */

interface DepotRecu {
  id: string;
  client_id: string;
  depose_par: string;
  depose_le: Date;
  piece_libelle: string;
  demande_id: string;
  demande_titre: string;
  mission_id: string;
  chef_id: string | null;
  directeur_id: string | null;
  fichier_nom: string;
}

async function lireDepot(db: Db, depotId: string): Promise<DepotRecu | undefined> {
  const r = await db.query(
    `SELECT x.id, x.client_id, x.depose_par, x.depose_le, p.libelle AS piece_libelle,
       d.id AS demande_id, d.titre AS demande_titre, d.mission_id, m.chef_id, m.directeur_id,
       f.nom_origine AS fichier_nom
     FROM salle_depots x
     JOIN salle_pieces p ON p.id = x.piece_id
     JOIN salle_demandes d ON d.id = x.demande_id
     JOIN missions m ON m.id = d.mission_id
     JOIN fichiers f ON f.id = x.fichier_id
     WHERE x.id = $1 AND x.origine = 'portail'
       AND NOT EXISTS (SELECT 1 FROM salle_accuses a WHERE a.depot_id = x.id)`,
    [depotId],
  );
  return r.rows[0] as DepotRecu | undefined;
}

async function accuserReception(
  db: Db,
  cabinetId: string,
  depot: DepotRecu,
): Promise<NotificationCreee | null> {
  const coupe = (await lireCoupeCircuit(db)).actif;
  const cabinet = await nomCabinet(db, cabinetId);
  const notification = coupe
    ? null
    : await notifier(db, {
        cabinetId,
        destinataireId: depot.depose_par,
        type: "salle_accuse_reception",
        titre: `Accusé de réception : « ${depot.piece_libelle} »`,
        corps: `${cabinet} a bien reçu votre document « ${depot.fichier_nom} » pour la pièce « ${depot.piece_libelle} » (demande « ${depot.demande_titre} »), le ${horodatageFr(new Date(depot.depose_le))}. L'équipe de mission va l'examiner ; vous serez prévenu si un complément est nécessaire.`,
        lien: `/portail/salle/${depot.demande_id}`,
        email: true,
      });
  await db.query(
    `INSERT INTO salle_accuses (cabinet_id, depot_id, client_id, destinataire_id, notification_id,
       statut)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      cabinetId,
      depot.id,
      depot.client_id,
      depot.depose_par,
      notification?.id ?? null,
      notification ? "envoye" : "suspendu",
    ],
  );
  await journaliser(db, {
    cabinetId,
    utilisateurId: null,
    action: notification ? "accuse_reception" : "accuse_reception_suspendu",
    entite: "salle_depot",
    entiteId: depot.id,
    details: {
      classe_risque: "R0",
      automatique: true,
      destinataire_id: depot.depose_par,
      notification_id: notification?.id ?? null,
      ...(notification ? {} : { motif: coupe ? "coupe_circuit_n4" : "destinataire_inactif" }),
    },
  });
  return notification;
}

async function informerEquipe(db: Db, cabinetId: string, depot: DepotRecu): Promise<void> {
  const ids = new Set([depot.chef_id, depot.directeur_id].filter((x): x is string => Boolean(x)));
  for (const id of ids) {
    await notifier(db, {
      cabinetId,
      destinataireId: id,
      type: "salle_piece_recue",
      titre: `Pièce reçue : « ${depot.piece_libelle} »`,
      corps: `Le client a déposé « ${depot.fichier_nom} » pour la pièce « ${depot.piece_libelle} » (demande « ${depot.demande_titre} ») : à accepter ou à rejeter.`,
      lien: `/missions/${depot.mission_id}/salle/${depot.demande_id}`,
    });
  }
}

/** Suite d'un dépôt du portail : accusé de réception (R0) et information de l'équipe. */
export async function suiteDepotPortail(
  app: FastifyInstance,
  cabinetId: string,
  depotId: string,
): Promise<void> {
  try {
    await horsContextePortail(async () => {
      const email = await app.db.withTenant(cabinetId, async (db) => {
        const depot = await lireDepot(db, depotId);
        if (!depot) return null;
        const accuse = await accuserReception(db, cabinetId, depot);
        await informerEquipe(db, cabinetId, depot);
        return accuse;
      });
      await envoyerEmails(app.mailer, [email], (m) => app.log.warn(m));
    });
  } catch (error) {
    app.log.error(
      { message: (error as Error).message, depot_id: depotId },
      "Accusé de réception de la salle de mission non traité.",
    );
  }
}
