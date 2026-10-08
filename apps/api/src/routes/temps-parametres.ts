import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  activiteInterneCreationSchema,
  activiteInterneModificationSchema,
  tempsParametresSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { clauseSet, traduireErreursPg } from "../db/outils.js";
import { introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { lireParametresTemps } from "../temps/outils.js";

const COLONNES_ACTIVITE = "id, code, libelle, est_absence, actif, cree_le";

const activitesQuerySchema = z
  .object({ inclure_inactives: z.enum(["true", "false"]).optional() })
  .strict();

/** Paramètres de saisie des temps (SOC-04, TPS-01, TPS-07) et activités internes (TPS-02). */
export const routesTempsParametres: FastifyPluginAsync = async (app) => {
  app.get("/temps/parametres", async (request) => {
    const auth = exiger(request);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametresTemps(db, auth.cabinetId);
      return {
        unite_saisie_temps: p.granularite,
        heures_par_jour: p.heuresParJour,
        controle_capacite: p.controleCapacite,
        seuil_consommation_pct: p.seuilConsommationPct,
      };
    });
  });

  app.patch("/temps/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const d = tempsParametresSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await lireParametresTemps(db, auth.cabinetId);
      await db.query(
        `INSERT INTO parametres_temps (cabinet_id, controle_capacite, seuil_consommation_pct)
         VALUES ($1, $2, $3)
         ON CONFLICT (cabinet_id) DO UPDATE SET controle_capacite = EXCLUDED.controle_capacite,
           seuil_consommation_pct = EXCLUDED.seuil_consommation_pct, modifie_le = now()`,
        [
          auth.cabinetId,
          d.controle_capacite ?? avant.controleCapacite,
          d.seuil_consommation_pct ?? avant.seuilConsommationPct,
        ],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "parametres_temps",
        entiteId: auth.cabinetId,
        details: {
          avant: {
            controle_capacite: avant.controleCapacite,
            seuil_consommation_pct: avant.seuilConsommationPct,
          },
          apres: d,
        },
      });
      const p = await lireParametresTemps(db, auth.cabinetId);
      return {
        unite_saisie_temps: p.granularite,
        heures_par_jour: p.heuresParJour,
        controle_capacite: p.controleCapacite,
        seuil_consommation_pct: p.seuilConsommationPct,
      };
    });
  });

  app.get("/activites-internes", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = activitesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_ACTIVITE} FROM activites_internes
         WHERE ($1::boolean OR actif) ORDER BY libelle, id`,
        [q.inclure_inactives === "true"],
      );
      return { elements: r.rows };
    });
  });

  app.post("/activites-internes", async (request, reply) => {
    const auth = exiger(request, "cabinet.gerer");
    const d = activiteInterneCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO activites_internes (cabinet_id, code, libelle, est_absence)
           VALUES ($1, $2, $3, $4) RETURNING ${COLONNES_ACTIVITE}`,
          [auth.cabinetId, d.code, d.libelle, d.est_absence ?? false],
        ),
        { "*": "Une activité interne porte déjà ce code." },
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "activite_interne",
        entiteId: r.rows[0].id as string,
        details: { code: d.code },
      });
      return r.rows[0];
    });
    reply.status(201);
    return creee;
  });

  app.patch("/activites-internes/:id", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    const d = activiteInterneModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const set = clauseSet(d, 2);
      const r = await db.query(
        `UPDATE activites_internes SET ${set.sql} WHERE id = $1 RETURNING ${COLONNES_ACTIVITE}`,
        [id, ...set.valeurs],
      );
      if (!r.rows[0]) throw introuvable("Activité interne");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "activite_interne",
        entiteId: id,
        details: { apres: d },
      });
      return r.rows[0];
    });
  });
};
