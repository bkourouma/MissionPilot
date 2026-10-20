import { comparer, zero } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import { exigerFactureVisible } from "../facturation/factures.js";
import type { MessageEmail } from "../notifications/mailer.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { situationFacture } from "./paiements.js";
import { enregistrerRelance } from "./relances.js";

/*
 * SERVICE COMMUN DE LA RELANCE MANUELLE D'UNE FACTURE (FIN-09), appelé par la route
 * `POST /api/factures/:id/relances` ET par le copilote (AGT-08, copilote/actions.ts) : un seul
 * endroit pour les contrôles (facture visible, émise, restant due, une seule relance manuelle avec
 * e-mail par jour) et les écritures (relance, notification de l'équipe, journal). Extrait tel quel
 * de la route ; le copilote l'appelle toujours SANS e-mail au client.
 */

export interface DemandeRelanceManuelle {
  envoyer_email: boolean;
  /** Niveau explicite ; absent : le niveau suivant (au plus 3). */
  niveau?: number | undefined;
  message?: string | null | undefined;
}

export interface RelanceManuelleFaite {
  relance: Record<string, unknown> | undefined;
  /** E-mail au client à envoyer APRÈS validation de la transaction (jamais sans `envoyer_email`). */
  email: MessageEmail | null;
  notifications: NotificationCreee[];
}

/** Relance manuelle d'une facture émise restant due, dans la transaction reçue. */
export async function relancerFactureManuellement(
  db: Db,
  auth: Auth,
  id: string,
  demande: DemandeRelanceManuelle,
  date: string,
  via?: string,
): Promise<RelanceManuelleFaite> {
  const { facture } = await exigerFactureVisible(db, auth, id, true);
  if (facture.nature !== "facture" || facture.statut !== "emise") {
    throw conflit("Seule une facture émise se relance.");
  }
  const s = await situationFacture(db, id, date);
  if (!s || comparer(s.situation.solde, zero(s.situation.solde.devise)) <= 0) {
    throw conflit("La facture est soldée : rien à relancer.");
  }
  if (demande.envoyer_email) {
    // Une seule relance manuelle AVEC e-mail par facture et par jour : le
    // client n'est pas inondé (contrôle sous le verrou de la facture).
    const dejaEnvoyee = await db.query(
      `SELECT 1 FROM relances_factures
       WHERE facture_id = $1 AND mode = 'manuelle' AND email_envoye AND date_relance = $2`,
      [id, date],
    );
    if (dejaEnvoyee.rowCount) {
      throw new AppError(
        409,
        "RELANCE_DEJA_ENVOYEE",
        "Un e-mail de relance a déjà été envoyé au client aujourd'hui pour cette facture : relancer sans e-mail, ou réessayer demain.",
      );
    }
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
    details: {
      niveau,
      mode: "manuelle",
      email: creee.email !== null,
      ...(via ? { via } : {}),
    },
  });
  const r = await db.query(
    `SELECT id, facture_id, niveau, mode, date_relance::text AS date_relance, jours_retard,
       destinataire_email, email_sujet, email_texte, email_envoye, cree_par, cree_le
     FROM relances_factures WHERE id = $1`,
    [creee.id],
  );
  return {
    relance: r.rows[0] as Record<string, unknown> | undefined,
    email: creee.email,
    notifications: creee.notifications,
  };
}
