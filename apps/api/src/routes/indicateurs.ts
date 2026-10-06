import type { FastifyPluginAsync } from "fastify";
import { aPermission, indicateursQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { calculerIndicateurs } from "../finance/indicateurs.js";

/**
 * Indicateurs de pilotage du cabinet (PRD) : « indicateurs.cabinet ». Les
 * indicateurs de coût, de marge, de réalisation, d'encours et le carnet de
 * commandes valorisé (`carnet_commandes`, dérivé des taux de vente) exigent
 * « finance.lire » ; le carnet fondé sur le facturé
 * (`carnet_commandes_facture`) « budget.lire_montants » ou « finance.lire » :
 * champs ABSENTS sinon (finance/indicateurs.ts).
 */
export const routesIndicateurs: FastifyPluginAsync = async (app) => {
  app.get("/indicateurs/cabinet", async (request) => {
    const auth = exiger(request, "indicateurs.cabinet");
    const q = indicateursQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      calculerIndicateurs(db, auth, {
        du: q.du,
        au: q.au,
        dateReference: q.date_reference ?? q.au,
        niveau: q.niveau,
        finance: aPermission(auth.roles, "finance.lire"),
        montants: aPermission(auth.roles, "budget.lire_montants"),
      }),
    );
  });
};
