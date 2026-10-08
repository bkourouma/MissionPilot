import type { FastifyPluginAsync } from "fastify";
import {
  coutsMissionsQuerySchema,
  coutsQuerySchema,
  SEUIL_RATIO_COUT_IA,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { coutsCabinet, coutsMissions, DATE_TAUX_USD_DEPART, TAUX_USD_DEPART } from "../ia/couts.js";
import { lireParametres, plafondEffectif, sourceCleDisponible } from "../ia/parametres.js";

/*
 * Coûts IA (PRD : coût API d'une mission ≤ 5 % de son prix).
 *
 * DÉCISION DE DROITS : les coûts IA sont des données de GESTION du cabinet
 * (consommation, plafond, rapport au prix des missions). Ils exigent
 * « ia.configurer » ET « finance.lire » : en pratique les associés. Le
 * gestionnaire (finance.lire sans ia.configurer) ne les voit pas, pas plus
 * qu'un consultant (ia.utiliser) ; le coût d'une génération est ABSENT de ses
 * réponses sans « finance.lire ».
 */

export const routesIaCouts: FastifyPluginAsync = async (app) => {
  app.get("/ia/couts", async (request) => {
    const auth = exiger(request, "ia.configurer");
    exiger(request, "finance.lire");
    const q = coutsQuerySchema.parse(request.query);
    const mois = q.mois ? new Date(`${q.mois}-01T00:00:00Z`) : new Date();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametres(db);
      const effectif = plafondEffectif(p, app.config, sourceCleDisponible(p, app.config));
      return {
        unite: "micro_usd",
        seuil_ratio_mission: SEUIL_RATIO_COUT_IA,
        taux_conversion: { usd_vers: TAUX_USD_DEPART, date: DATE_TAUX_USD_DEPART, a_valider: true },
        ...(await coutsCabinet(db, mois, p.plafond_mensuel_micro_usd, effectif)),
      };
    });
  });

  app.get("/ia/couts/missions", async (request) => {
    const auth = exiger(request, "ia.configurer");
    exiger(request, "finance.lire");
    const q = coutsMissionsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => coutsMissions(db, auth, q.curseur, q.limite));
  });
};
