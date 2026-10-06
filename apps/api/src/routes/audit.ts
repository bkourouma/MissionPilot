import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";

const auditQuery = z
  .object({
    entite: z.string().trim().max(60).optional(),
    entite_id: z.string().trim().max(100).optional(),
    action: z.string().trim().max(60).optional(),
    utilisateur_id: z.string().uuid().optional(),
    du: z.string().date().optional(),
    au: z.string().date().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    /** Identifiant de la dernière entrée reçue : la page suivante est plus ancienne. */
    curseur: z.coerce.number().int().positive().optional(),
  })
  .strict();

/** Consultation du journal d'audit (SOC-06), du plus récent au plus ancien. */
export const routesAudit: FastifyPluginAsync = async (app) => {
  app.get("/audit", async (request) => {
    const auth = exiger(request, "audit.lire");
    const q = auditQuery.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT j.id::text AS id, j.action, j.entite, j.entite_id, j.details, j.cree_le,
                j.utilisateur_id, u.nom AS utilisateur_nom
         FROM journal_audit j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
         WHERE ($1::text IS NULL OR j.entite = $1)
           AND ($2::text IS NULL OR j.entite_id = $2)
           AND ($3::text IS NULL OR j.action = $3)
           AND ($4::uuid IS NULL OR j.utilisateur_id = $4)
           AND ($5::date IS NULL OR j.cree_le >= $5::date)
           AND ($6::date IS NULL OR j.cree_le < $6::date + 1)
           AND ($7::bigint IS NULL OR j.id < $7)
         ORDER BY j.id DESC
         LIMIT $8`,
        [
          q.entite ?? null,
          q.entite_id ?? null,
          q.action ?? null,
          q.utilisateur_id ?? null,
          q.du ?? null,
          q.au ?? null,
          q.curseur ?? null,
          q.limite + 1,
        ],
      );
      const elements = r.rows.slice(0, q.limite);
      const derniere = elements[elements.length - 1];
      return {
        elements,
        curseur_suivant: r.rows.length > q.limite && derniere ? derniere.id : null,
      };
    });
  });
};
