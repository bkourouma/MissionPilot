import type { ContexteTenantDemo } from "../contexte.js";
import { antidaterComptesPortail } from "./antidatage-notations-comptes.js";
import {
  MISSIONS_ANTIDATEES,
  planifier,
  type PlanMission,
} from "./antidatage-notations-fenetres.js";
import { antidaterNotation } from "./antidatage-notations-notation.js";
import { antidaterQuestionnaires } from "./antidatage-notations-questionnaires.js";
import { antidaterReferences } from "./antidatage-notations-references.js";
import { trouverMission } from "./casting.js";

/*
 * Fin de phase « antidatage-notations » : remonte à la période de leur mission les DATES
 * techniques des questionnaires et notations des missions TERMINÉES (1, 2, 3 et 5), des
 * explications IA liées, des données de référence qu'elles utilisent et des comptes de portail de
 * leurs répondants. Aucun contenu ni statut modifié ; rejouable (mêmes instants, même ordre).
 * Détail des fenêtres : antidatage-notations-fenetres.ts ; outil : antidatage.ts.
 */
export async function antidaterNotationsEtQuestionnaires(ctx: ContexteTenantDemo): Promise<void> {
  const plans: PlanMission[] = [];
  for (const cible of MISSIONS_ANTIDATEES) {
    plans.push(await planifier(ctx, await trouverMission(ctx, cible)));
  }
  const premierUsage = plans.map((p) => p.tot.debut).sort()[0] as string;
  await antidaterReferences(ctx, premierUsage);
  for (const plan of plans) {
    await antidaterQuestionnaires(ctx, plan);
    await antidaterNotation(ctx, plan);
  }
  await antidaterComptesPortail(ctx);
}
