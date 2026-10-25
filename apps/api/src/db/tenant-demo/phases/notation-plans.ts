import type { ContexteTenantDemo } from "../contexte.js";
import { executerEtapes } from "../notation-plans/etapes.js";

/*
 * Phase « notation-plans » du seed « Tenant démo » (lot 3) : questionnaires, notation financière,
 * KPI et plans stratégiques, rattachés aux missions créées par la phase « missions » (casting :
 * notation-plans/casting.ts). Tout passe par les vraies routes ; les chiffres sortent des moteurs.
 * Les étapes (notation-plans/etapes.ts) sont idempotentes : une phase interrompue se rejoue.
 */
export async function semerNotationPlans(ctx: ContexteTenantDemo): Promise<void> {
  await executerEtapes(ctx);
}
