import type { FastifyPluginAsync } from "fastify";
import { feriesParDefaut, PAYS_UEMOA, type PaysUEMOA } from "@missionpilot/engines";
import { feriesParDefautSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";

const COLONNES_FERIE = "id, date::text AS date, libelle, nationale, a_valider";

/**
 * Jours fériés par défaut (SOC-04) : pré-remplit le calendrier du cabinet avec
 * `feriesParDefaut(pays, annee)` du moteur. Idempotent : une date déjà saisie
 * n'est ni dupliquée ni modifiée. Les valeurs ajoutées sont marquées « à
 * valider » ; les fêtes musulmanes restent à saisir par le cabinet.
 */
export const routesFeriesDefaut: FastifyPluginAsync = async (app) => {
  app.post("/cabinet/feries/par-defaut", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { annee } = feriesParDefautSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const cabinet = await db.query("SELECT pays FROM cabinets WHERE id = $1", [auth.cabinetId]);
      const pays = String(cabinet.rows[0]?.pays ?? "").trim();
      if (!(PAYS_UEMOA as readonly string[]).includes(pays)) {
        throw requeteInvalide(
          "Jours fériés par défaut disponibles pour les pays de l'UEMOA uniquement.",
        );
      }
      const ajoutes: Record<string, unknown>[] = [];
      for (const f of feriesParDefaut(pays as PaysUEMOA, annee)) {
        const r = await db.query(
          `INSERT INTO cabinet_feries (cabinet_id, date, libelle, nationale, a_valider)
           VALUES ($1, $2, $3, true, true) ON CONFLICT (cabinet_id, date) DO NOTHING
           RETURNING ${COLONNES_FERIE}`,
          [auth.cabinetId, f.date, f.libelle],
        );
        if (r.rows[0]) ajoutes.push(r.rows[0]);
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "feries_par_defaut",
        entite: "cabinet",
        entiteId: auth.cabinetId,
        details: { pays, annee, ajoutes: ajoutes.length },
      });
      const tous = await db.query(
        `SELECT ${COLONNES_FERIE} FROM cabinet_feries WHERE extract(year FROM date) = $1 ORDER BY date`,
        [annee],
      );
      return { pays, annee, ajoutes: ajoutes.length, elements: tous.rows };
    });
  });

  /** Valide un jour férié pré-rempli (retire la marque « à valider »). */
  app.post("/cabinet/feries/:id/valider", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `UPDATE cabinet_feries SET a_valider = false WHERE id = $1 RETURNING ${COLONNES_FERIE}`,
        [id],
      );
      if (!r.rows[0]) throw introuvable("Jour férié");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "validation",
        entite: "ferie",
        entiteId: id,
        details: { date: r.rows[0].date },
      });
      return r.rows[0];
    });
  });
};
