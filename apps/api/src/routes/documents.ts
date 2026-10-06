import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { documentCreationSchema, TYPES_DOCUMENT } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { traduireErreursPg } from "../db/outils.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";

const COLONNES = `d.id, d.mission_id, d.type, d.nom, d.version, d.auteur_id, u.nom AS auteur_nom,
  d.chemin_stockage, d.cree_le`;
const DEPUIS = "mission_documents d LEFT JOIN utilisateurs u ON u.id = d.auteur_id";

const listeQuery = z
  .object({
    type: z.enum(TYPES_DOCUMENT).optional(),
    /** Toutes les versions (par défaut : la dernière de chaque document). */
    historique: z.enum(["true", "false"]).optional(),
  })
  .strict();

/**
 * Documents de mission (SOC-05) : métadonnées versionnées, sans fichier
 * binaire pour l'instant. Lecture : mission visible ; écriture : « document.ecrire »
 * et mission visible (un membre de l'équipe dépose ses livrables).
 */
export const routesDocuments: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/documents", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = listeQuery.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const r = await db.query(
        `SELECT ${COLONNES} FROM ${DEPUIS}
         WHERE d.mission_id = $1 AND ($2::text IS NULL OR d.type = $2)
           AND ($3::boolean OR d.version = (SELECT max(x.version) FROM mission_documents x
                 WHERE x.mission_id = d.mission_id AND x.type = d.type AND x.nom = d.nom))
         ORDER BY d.type, lower(d.nom), d.version DESC`,
        [id, q.type ?? null, q.historique === "true"],
      );
      return { elements: r.rows };
    });
  });

  /** Dépose un document ; même type et même nom → version suivante. */
  app.post("/missions/:id/documents", async (request, reply) => {
    const auth = exiger(request, "document.ecrire");
    const { id } = paramsId.parse(request.params);
    const doc = documentCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      // Verrou sur la mission : deux dépôts simultanés reçoivent deux versions distinctes.
      await exigerMissionVisible(db, auth, id, true);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id,
             chemin_stockage)
           SELECT $1, $2, $3, $4, coalesce(max(version), 0) + 1, $5, $6
           FROM mission_documents WHERE mission_id = $2 AND type = $3 AND nom = $4
           RETURNING id`,
          [auth.cabinetId, id, doc.type, doc.nom, auth.utilisateurId, doc.chemin_stockage ?? null],
        ),
        { "*": "Une autre version vient d'être déposée : réessayer." },
      );
      const lu = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE d.id = $1`, [
        r.rows[0].id,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "depot_document",
        entite: "mission_document",
        entiteId: r.rows[0].id,
        details: { mission_id: id, type: doc.type, nom: doc.nom, version: lu.rows[0].version },
      });
      return lu.rows[0];
    });
    reply.status(201);
    return cree;
  });
};
