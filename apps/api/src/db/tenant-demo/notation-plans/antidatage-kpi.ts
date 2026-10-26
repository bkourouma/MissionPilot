import type { ContexteTenantDemo } from "../contexte.js";
import { finirSuiviMission } from "./antidatage-kpi-fin.js";
import {
  antidaterCiblesEtContributeurs,
  antidaterDefinitions,
  antidaterMesuresEtAlertes,
  bornesKpi,
} from "./antidatage-kpi-instants.js";
import { antidaterPilotage } from "./antidatage-kpi-pilotage.js";
import { trouverMission } from "./casting.js";
import { MISSION_ATLANTIQUE, MISSION_SAHEL } from "./kpi-cat-sahel-atlantique.js";
import { MISSION_SICAFE } from "./kpi-cat-sicafe.js";
import type { SpecMissionKpi } from "./kpi-types.js";

/*
 * Fin de la phase « notation-plans » pour les KPI des missions TERMINÉES 1 (SICAFE), 2 (Sahel
 * Coton) et 5 (Atlantique Retail). Les missions 6, 9 et 10 ne sont jamais touchées.
 *
 * 1. FIN DE SUIVI (route PATCH /api/kpi/:id, antidatage-kpi-fin.ts) : tous les KPI actifs, y compris
 *    ceux que les plans ont créés, sont désactivés avec `fin_suivi` = fin de la mission. La route
 *    horodate la modification « maintenant » : l'antidatage vient donc APRÈS.
 * 2. ANTIDATAGE (antidatage-kpi-instants.ts, antidatage-kpi-pilotage.ts) des instants techniques
 *    dans la période de la mission (début ≤ instant ≤ fin + 4 jours). Les plans (étape précédente
 *    de `fin.ts`) sont déjà antidatés : une définition créée par un plan suit son lien d'objectif.
 * Rejouable : les deux parties sont idempotentes.
 */

const MISSIONS_KPI: readonly SpecMissionKpi[] = [MISSION_SICAFE, MISSION_SAHEL, MISSION_ATLANTIQUE];

export async function finirSuiviKpi(ctx: ContexteTenantDemo): Promise<void> {
  for (const spec of MISSIONS_KPI) {
    const mission = await trouverMission(ctx, spec.mission);
    const bilan = await finirSuiviMission(ctx, mission);
    const b = bornesKpi(ctx, mission);
    const libelles = spec.kpis.map((k) => k.libelle);
    await antidaterDefinitions(ctx, b, libelles);
    await antidaterCiblesEtContributeurs(ctx, b);
    await antidaterMesuresEtAlertes(ctx, b);
    await antidaterPilotage(ctx, b);
    ctx.journal(
      `    fin de suivi KPI « ${mission.intitule} » : ${bilan.avecFin} avec fin_suivi` +
        (bilan.sansFin.length ? `, ${bilan.sansFin.length} désactivés seulement` : ""),
    );
  }
}
