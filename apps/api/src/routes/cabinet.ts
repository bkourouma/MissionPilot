import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { cabinetModificationSchema, ferieCreationSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { clauseSet, traduireErreursPg } from "../db/outils.js";
import { introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";

const COLONNES_CABINET = `id, nom, pays, devise_base, unite_saisie_temps,
  heures_par_jour::float8 AS heures_par_jour, jours_travailles, cree_le`;
const COLONNES_FERIE = "id, date::text AS date, libelle, nationale, a_valider";

const feriesQuery = z.object({ annee: z.coerce.number().int().min(2000).max(2100).optional() });

/** Paramètres du cabinet (SOC-04). Lecture : tout utilisateur connecté ; écriture : cabinet.gerer. */
export const routesCabinet: FastifyPluginAsync = async (app) => {
  app.get("/cabinet", async (request) => {
    const auth = exiger(request);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(`SELECT ${COLONNES_CABINET} FROM cabinets WHERE id = $1`, [
        auth.cabinetId,
      ]);
      if (!r.rows[0]) throw introuvable("Cabinet");
      return r.rows[0];
    });
  });

  app.patch("/cabinet", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const modif = cabinetModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = (
        await db.query(`SELECT ${COLONNES_CABINET} FROM cabinets WHERE id = $1 FOR UPDATE`, [
          auth.cabinetId,
        ])
      ).rows[0];
      if (!avant) throw introuvable("Cabinet");
      const set = clauseSet(modif, 2);
      const r = await db.query(
        `UPDATE cabinets SET ${set.sql} WHERE id = $1 RETURNING ${COLONNES_CABINET}`,
        [auth.cabinetId, ...set.valeurs],
      );
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "cabinet",
        entiteId: auth.cabinetId,
        details: {
          avant: Object.fromEntries(champs.map((c) => [c, avant[c]])),
          apres: Object.fromEntries(champs.map((c) => [c, r.rows[0][c]])),
        },
      });
      return r.rows[0];
    });
  });

  app.get("/cabinet/feries", async (request) => {
    const auth = exiger(request);
    const { annee } = feriesQuery.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_FERIE} FROM cabinet_feries
         WHERE $1::int IS NULL OR extract(year FROM date) = $1 ORDER BY date`,
        [annee ?? null],
      );
      return { elements: r.rows };
    });
  });

  app.post("/cabinet/feries", async (request, reply) => {
    const auth = exiger(request, "cabinet.gerer");
    const ferie = ferieCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO cabinet_feries (cabinet_id, date, libelle, nationale)
           VALUES ($1, $2, $3, $4) RETURNING ${COLONNES_FERIE}`,
          [auth.cabinetId, ferie.date, ferie.libelle, ferie.nationale],
        ),
        { "*": "Un jour férié existe déjà à cette date." },
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "ferie",
        entiteId: r.rows[0].id,
        details: { apres: r.rows[0] },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.delete("/cabinet/feries/:id", async (request, reply) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `DELETE FROM cabinet_feries WHERE id = $1 RETURNING ${COLONNES_FERIE}`,
        [id],
      );
      if (!r.rows[0]) throw introuvable("Jour férié");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "ferie",
        entiteId: id,
        details: { avant: r.rows[0] },
      });
    });
    return reply.status(204).send();
  });
};
