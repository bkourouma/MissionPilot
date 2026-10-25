import type { ContexteTenantDemo } from "../contexte.js";
import { finirSuiviKpi } from "./antidatage-kpi.js";
import { antidaterNotationsEtQuestionnaires } from "./antidatage-notations.js";
import { antidaterPlans } from "./antidatage-plans.js";

/*
 * Dernière étape de la phase « notation-plans » : met les objets des missions TERMINÉES (1 à 5)
 * dans la période de leur mission (antidatage borné, antidatage.ts), puis met fin au suivi de leurs
 * KPI (les missions sont clôturées à la fin de la phase « gestion » : sans cela, le suivi
 * quotidien des phases suivantes signalerait des « mesures en retard » sur des missions finies).
 * Rejouable : les étapes sont idempotentes.
 */
export async function terminerMissionsTerminees(ctx: ContexteTenantDemo): Promise<void> {
  await antidaterNotationsEtQuestionnaires(ctx);
  await antidaterPlans(ctx);
  await finirSuiviKpi(ctx);
}
