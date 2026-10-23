import type { CommentaireCreation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { authDe, exigerEntiteVisible, voitEntite } from "./entites.js";

/*
 * SERVICE COMMUN DE CRÉATION D'UN COMMENTAIRE (SOC-08), appelé par la route
 * `POST /api/commentaires` ET par le copilote (AGT-08, copilote/actions.ts) : un seul endroit pour
 * les contrôles (entité visible, mentions d'utilisateurs actifs qui voient l'entité) et les
 * écritures (INSERT, journal SANS le texte, notification des mentionnés), afin qu'un durcissement
 * vaille pour les deux chemins. Extrait tel quel de la route.
 */

export interface CommentaireCree {
  id: string;
  /** Lien relatif interne vers l'entité commentée. */
  lien: string;
  /** Notifications des personnes mentionnées (e-mails à envoyer APRÈS validation de la transaction). */
  notifications: (NotificationCreee | null)[];
}

/**
 * Crée un commentaire dans la transaction reçue, sous les droits de `auth` (entité visible, sinon
 * 404). `via` précise l'origine dans le journal (par ex. « copilote »).
 */
export async function creerCommentaire(
  db: Db,
  auth: Auth,
  c: CommentaireCreation,
  via?: string,
): Promise<CommentaireCree> {
  const entite = await exigerEntiteVisible(db, auth, c.entite_type, c.entite_id);
  const mentions = c.mentions.filter((id) => id !== auth.utilisateurId);
  // Mentions : utilisateurs actifs du cabinet (un autre cabinet est inconnu) qui voient l'entité.
  for (const id of mentions) {
    const autre = await authDe(db, auth.cabinetId, id);
    if (!autre) throw requeteInvalide("Utilisateur mentionné inconnu ou inactif.");
    if (!(await voitEntite(db, autre, c.entite_type, c.entite_id))) {
      throw requeteInvalide(`${autre.nom} n'a pas accès à cet élément : mention impossible.`);
    }
  }
  const k = entite.colonnes;
  const r = await db.query(
    `INSERT INTO commentaires (cabinet_id, entite_type, entite_id, mission_id, tache_id,
       facture_id, debours_id, opportunite_id, proposition_id, auteur_id, texte, mentions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      auth.cabinetId,
      c.entite_type,
      c.entite_id,
      k.mission_id,
      k.tache_id,
      k.facture_id,
      k.debours_id,
      k.opportunite_id,
      k.proposition_id,
      auth.utilisateurId,
      c.texte,
      mentions,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "commentaire",
    entiteId: id,
    // Jamais le texte dans le journal : il peut citer des données de la mission.
    details: {
      entite_type: c.entite_type,
      entite_id: c.entite_id,
      mentions: mentions.length,
      ...(via ? { via } : {}),
    },
  });
  const notifications: (NotificationCreee | null)[] = [];
  for (const destinataire of mentions) {
    notifications.push(
      await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: destinataire,
        type: "mention_commentaire",
        titre: `${auth.nom} vous a mentionné dans un commentaire`,
        lien: entite.lien,
        email: true,
      }),
    );
  }
  return { id, lien: entite.lien, notifications };
}
