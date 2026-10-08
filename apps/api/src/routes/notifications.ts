import type { FastifyPluginAsync } from "fastify";
import { notificationsQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { introuvable } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";

const COLONNES = "n.id, n.type, n.titre, n.corps, n.lien, n.lue_le, n.cree_le";

/**
 * Clé de tri croissante : non lues d'abord (« 0 »), puis les plus récentes
 * d'abord (horodatage inversé, en microsecondes sur 16 chiffres).
 */
const CLE_TRI = `(CASE WHEN n.lue_le IS NULL THEN '0' ELSE '1' END
  || lpad((9000000000000000 - (extract(epoch FROM n.cree_le) * 1000000)::bigint)::text, 16, '0'))`;

/**
 * Notifications in-app (SOC-08). Un utilisateur ne lit et ne marque que les
 * siennes : toute requête filtre sur destinataire_id = utilisateur connecté,
 * une notification d'autrui répond 404.
 */
export const routesNotifications: FastifyPluginAsync = async (app) => {
  app.get("/notifications", async (request) => {
    const auth = exiger(request);
    const q = notificationsQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM notifications n
         WHERE n.destinataire_id = $1
           AND ($2::boolean IS NOT TRUE OR n.lue_le IS NULL)
           AND ($3::text IS NULL OR (${CLE_TRI}, n.id) > ($3, $4::uuid))
         ORDER BY cle_tri, n.id
         LIMIT $5`,
        [
          auth.utilisateurId,
          q.non_lues === "true",
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const nonLues = await db.query(
        "SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND lue_le IS NULL",
        [auth.utilisateurId],
      );
      return { ...paginer(r.rows, q.limite), non_lues: nonLues.rows[0].n as number };
    });
  });

  app.post("/notifications/:id/lue", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `UPDATE notifications SET lue_le = coalesce(lue_le, now())
         WHERE id = $1 AND destinataire_id = $2 RETURNING id, lue_le`,
        [id, auth.utilisateurId],
      );
      if (!r.rows[0]) throw introuvable("Notification");
      return r.rows[0];
    });
  });

  app.post("/notifications/tout-lire", async (request) => {
    const auth = exiger(request);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `UPDATE notifications SET lue_le = now() WHERE destinataire_id = $1 AND lue_le IS NULL`,
        [auth.utilisateurId],
      );
      return { marquees: r.rowCount ?? 0 };
    });
  });
};
