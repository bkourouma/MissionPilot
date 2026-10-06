import type { FastifyPluginAsync } from "fastify";
import { exportComptableQuerySchema, planComptableSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { ecrituresComptables, versCsv } from "../finance/export.js";
import {
  enregistrerPlanComptable,
  lirePlanComptable,
  vuePlanComptable,
} from "../finance/plan-comptable.js";

/**
 * Export comptable (FIN-13) et plan comptable du cabinet :
 * « export.comptable » (associé, gestionnaire). Chaque export est journalisé
 * (qui, période, nombre de lignes et de pièces, jamais de montant).
 */
export const routesExportComptable: FastifyPluginAsync = async (app) => {
  app.get("/finance/plan-comptable", async (request) => {
    const auth = exiger(request, "export.comptable");
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vuePlanComptable(await lirePlanComptable(db)),
    );
  });

  app.patch("/finance/plan-comptable", async (request) => {
    const auth = exiger(request, "export.comptable");
    const saisie = planComptableSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await enregistrerPlanComptable(db, auth.cabinetId, auth.utilisateurId, saisie);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "plan_comptable",
        details: saisie,
      });
      return vuePlanComptable(await lirePlanComptable(db));
    });
  });

  app.get("/finance/export-comptable", async (request, reply) => {
    const auth = exiger(request, "export.comptable");
    const q = exportComptableQuerySchema.parse(request.query);
    const csv = await app.db.withTenant(auth.cabinetId, async (db) => {
      const plan = await lirePlanComptable(db);
      const ecritures = await ecrituresComptables(db, auth, q.du, q.au, plan);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "export",
        entite: "export_comptable",
        details: {
          du: q.du,
          au: q.au,
          format: q.format,
          separateur: q.separateur,
          lignes: ecritures.length,
          pieces: new Set(ecritures.map((e) => `${e.journal}|${e.piece}`)).size,
        },
      });
      return versCsv(ecritures, q);
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="ecritures-${q.du}-${q.au}.csv"`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .send(csv);
  });
};
