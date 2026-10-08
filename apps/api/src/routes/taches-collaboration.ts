import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  tacheCollaborationCreationSchema,
  tacheCollaborationModificationSchema,
  tachesCollaborationQuerySchema,
  type TypeEntiteCollaboration,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { authDe, exigerEntiteVisible, voitEntite } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";

/*
 * Tâches assignées (SOC-08), distinctes des tâches du découpage de mission.
 * - Création : « tache.assigner » ; l'assigné est un utilisateur ACTIF du même
 *   cabinet ; une entité liée doit être visible du créateur ET de l'assigné.
 * - Lecture : le créateur et l'assigné seulement (sinon 404).
 * - Modification : le créateur (avec « tache.assigner ») modifie tout ;
 *   l'assigné ne change que le statut (403 sinon).
 * - Notifications : l'assigné à la création et à la réassignation ; le
 *   créateur quand l'assigné passe la tâche à « fait ».
 * Jamais de suppression (le rôle applicatif n'a pas DELETE).
 */

const LIEN_MES_TACHES = "/mes-taches";

const COLONNES = `t.id, t.titre, t.description, t.assignee_id, a.nom AS assignee_nom, t.cree_par,
  c.nom AS cree_par_nom, t.echeance::text AS echeance, t.statut, t.fait_le, t.entite_type,
  t.entite_id, t.mission_id, t.cree_le, t.modifie_le`;
const DEPUIS = `taches_collaboration t JOIN utilisateurs a ON a.id = t.assignee_id
  JOIN utilisateurs c ON c.id = t.cree_par`;

/** Ouvertes d'abord, puis par échéance (sans échéance en dernier), puis par création. */
const CLE_TRI = `(CASE WHEN t.statut = 'fait' THEN '1' ELSE '0' END
  || coalesce(t.echeance::text, '9999-12-31')
  || lpad(((extract(epoch FROM t.cree_le) * 1000000)::bigint)::text, 17, '0'))`;

interface TacheDb extends Record<string, unknown> {
  id: string;
  titre: string;
  assignee_id: string;
  cree_par: string;
  statut: string;
  entite_type: TypeEntiteCollaboration | null;
  entite_id: string | null;
}

async function lireTache(db: Db, id: string, verrouiller = false): Promise<TacheDb> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE t.id = $1 ${verrouiller ? "FOR UPDATE OF t" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Tâche");
  return r.rows[0] as TacheDb;
}

/** Tâche du créateur ou de l'assigné, sinon 404. */
async function tacheVisible(db: Db, auth: Auth, id: string, verrouiller = false) {
  const t = await lireTache(db, id, verrouiller);
  if (t.cree_par !== auth.utilisateurId && t.assignee_id !== auth.utilisateurId) {
    throw introuvable("Tâche");
  }
  return t;
}

/** Assigné actif du cabinet, qui voit l'entité liée s'il y en a une. */
async function exigerAssignable(
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

export const routesTachesCollaboration: FastifyPluginAsync = async (app) => {
  app.post("/taches-collaboration", async (request, reply) => {
    const auth = exiger(request, "tache.assigner");
    const t = tacheCollaborationCreationSchema.parse(request.body);
    const { cree, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
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
        details: { assignee_id: t.assignee_id, entite_type: entite?.type ?? null },
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
      return { cree: await lireTache(db, id), notifications };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    reply.status(201);
    return cree;
  });

  /** « Mes tâches » (assignées à moi, par défaut) ou celles que j'ai créées ; paginé. */
  app.get("/taches-collaboration", async (request) => {
    const auth = exiger(request);
    const q = tachesCollaborationQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const colonne = q.vue === "creees" ? "t.cree_par" : "t.assignee_id";
      const r = await db.query(
        `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS}
         WHERE ${colonne} = $1 AND ($2::text IS NULL OR t.statut = $2)
           AND ($3::text IS NULL OR (${CLE_TRI}, t.id) > ($3, $4::uuid))
         ORDER BY cle_tri, t.id LIMIT $5`,
        [
          auth.utilisateurId,
          q.statut ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows as (TacheDb & { cle_tri: string })[], q.limite);
    });
  });

  app.get("/taches-collaboration/:id", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => tacheVisible(db, auth, id));
  });

  app.patch("/taches-collaboration/:id", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const modif = tacheCollaborationModificationSchema.parse(request.body);
    const { tache, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const t = await tacheVisible(db, auth, id, true);
      const createur = t.cree_par === auth.utilisateurId;
      const autresChamps = Object.keys(modif).some((k) => k !== "statut");
      // L'assigné ne change que le statut ; le créateur garde le droit d'assigner.
      if (autresChamps && (!createur || !aPermission(auth.roles, "tache.assigner"))) {
        throw interdit();
      }
      const entite = t.entite_type && t.entite_id ? { type: t.entite_type, id: t.entite_id } : null;
      const reassignee = modif.assignee_id !== undefined && modif.assignee_id !== t.assignee_id;
      if (reassignee) await exigerAssignable(db, auth, modif.assignee_id as string, entite);
      await db.query(
        `UPDATE taches_collaboration SET
           titre = coalesce($2, titre),
           description = coalesce($3, description),
           assignee_id = coalesce($4, assignee_id),
           echeance = CASE WHEN $5::boolean THEN $6::date ELSE echeance END,
           statut = coalesce($7, statut),
           fait_le = CASE WHEN coalesce($7, statut) = 'fait' THEN coalesce(fait_le, now()) ELSE NULL END,
           modifie_le = now()
         WHERE id = $1`,
        [
          id,
          modif.titre ?? null,
          modif.description ?? null,
          modif.assignee_id ?? null,
          modif.echeance !== undefined,
          modif.echeance ?? null,
          modif.statut ?? null,
        ],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "tache_collaboration",
        entiteId: id,
        details: { champs: Object.keys(modif), statut: modif.statut ?? null },
      });
      const notifications: (NotificationCreee | null)[] = [];
      const titre = modif.titre ?? t.titre;
      if (reassignee && modif.assignee_id !== auth.utilisateurId) {
        notifications.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: modif.assignee_id as string,
            type: "tache_assignee",
            titre: `Tâche assignée par ${auth.nom} : ${titre}`,
            lien: LIEN_MES_TACHES,
            email: true,
          }),
        );
      }
      if (modif.statut === "fait" && t.statut !== "fait" && !createur) {
        notifications.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: t.cree_par,
            type: "tache_faite",
            titre: `${auth.nom} a terminé la tâche : ${titre}`,
            lien: LIEN_MES_TACHES,
          }),
        );
      }
      return { tache: await lireTache(db, id), notifications };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return tache;
  });
};
