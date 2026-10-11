import type { TacheCollaborationCreation, TypeEntiteCollaboration } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { authDe, exigerEntiteVisible, voitEntite } from "./entites.js";

/*
 * SERVICE COMMUN DES TÂCHES ASSIGNÉES (SOC-08), appelé par la route
 * `POST /api/taches-collaboration` ET par le copilote (AGT-08, copilote/actions.ts) : un seul
 * endroit pour les contrôles et les écritures, afin qu'un durcissement (assigné interne et actif,
 * entité visible des deux personnes) vaille pour les deux chemins.
 */

export const LIEN_MES_TACHES = "/mes-taches";

/**
 * Assigné INTERNE actif du cabinet (jamais une personne du portail client : `authDe`), qui voit
 * l'entité liée s'il y en a une ; sinon 400.
 */
export async function exigerAssignable(
  db: Db,
  auth: Auth,
  assigneeId: string,
  entite: { type: TypeEntiteCollaboration; id: string } | null,
): Promise<Auth> {
  const assigne = await authDe(db, auth.cabinetId, assigneeId);
  if (!assigne) throw requeteInvalide("Assigné inconnu ou inactif.");
  if (entite && !(await voitEntite(db, assigne, entite.type, entite.id))) {
    throw requeteInvalide(`${assigne.nom} n'a pas accès à l'élément lié.`);
  }
  return assigne;
}

export interface TacheCreee {
  id: string;
  /** Notification de l'assigné (e-mail à envoyer APRÈS validation de la transaction). */
  notifications: (NotificationCreee | null)[];
}

/**
 * Crée une tâche assignée dans la transaction reçue : entité liée visible du créateur ET de
 * l'assigné, assigné interne actif du cabinet, INSERT, journal (`via` précise l'origine, par ex.
 * « copilote »), notification de l'assigné s'il n'est pas le créateur.
 */
export async function creerTacheAssignee(
  db: Db,
  auth: Auth,
  t: TacheCollaborationCreation,
  via?: string,
): Promise<TacheCreee> {
  const entite =
    t.entite_type && t.entite_id
      ? await exigerEntiteVisible(db, auth, t.entite_type, t.entite_id)
      : null;
  await exigerAssignable(db, auth, t.assignee_id, entite);
  const k = entite?.colonnes;
  const r = await db.query(
    `INSERT INTO taches_collaboration (cabinet_id, titre, description, assignee_id, cree_par,
       echeance, entite_type, entite_id, mission_id, tache_id, facture_id, debours_id,
       opportunite_id, proposition_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      auth.cabinetId,
      t.titre,
      t.description,
      t.assignee_id,
      auth.utilisateurId,
      t.echeance,
      entite?.type ?? null,
      entite?.id ?? null,
      k?.mission_id ?? null,
      k?.tache_id ?? null,
      k?.facture_id ?? null,
      k?.debours_id ?? null,
      k?.opportunite_id ?? null,
      k?.proposition_id ?? null,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "tache_collaboration",
    entiteId: id,
    details: {
      assignee_id: t.assignee_id,
      entite_type: entite?.type ?? null,
      ...(via ? { via } : {}),
    },
  });
  const notifications: (NotificationCreee | null)[] = [];
  if (t.assignee_id !== auth.utilisateurId) {
    notifications.push(
      await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: t.assignee_id,
        type: "tache_assignee",
        titre: `Tâche assignée par ${auth.nom} : ${t.titre}`,
        corps: t.echeance ? `Échéance : ${t.echeance}` : "",
        lien: LIEN_MES_TACHES,
        email: true,
      }),
    );
  }
  return { id, notifications };
}
