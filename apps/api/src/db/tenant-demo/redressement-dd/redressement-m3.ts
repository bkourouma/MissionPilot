import type { ContexteTenantDemo } from "../contexte.js";
import {
  causesV1M3,
  checklistModeleM3,
  creanciersAccordsM3,
  creanciersAvantV2M3,
  diagnosticInitialM3,
  diagnosticMaiM3,
  ouvertureM3,
  planVague1M3,
  planVague2M3,
  tresorerieV1M3,
  tresorerieV2M3,
} from "./redressement-m3-etapes-1.js";
import {
  causesV2M3,
  clotureM3,
  conformiteFinM3,
  covenantsV1M3,
  diagnosticFinM3,
  diagnosticJuilletM3,
  financementV1M3,
  paiementsM3,
  planVersion3M3,
  suiviM3,
  tresorerieV3M3,
  tresorerieV4M3,
} from "./redressement-m3-etapes-2.js";
import { recalibrerIndustrie2025 } from "./redressement-parametrage.js";

/*
 * Mission 3 « Redressement — Brasseries du Wouri » dans l'ordre chronologique fictif (mars 2025 à
 * novembre 2025, puis suivi jusqu'en octobre 2026). L'ordre d'appel compte : les scores d'alerte
 * conservent l'instantané des seuils en vigueur au moment du calcul (seuils « industrie » v1 en
 * mars et mai, v2 publiée le 1er juillet), et les échéances d'accords ne peuvent figurer dans une
 * prévision de trésorerie qu'une fois les accords conclus.
 */
export async function semerM3(ctx: ContexteTenantDemo): Promise<void> {
  await ouvertureM3(ctx);
  await diagnosticInitialM3(ctx);
  await checklistModeleM3(ctx);
  await tresorerieV1M3(ctx);
  await creanciersAvantV2M3(ctx);
  await planVague1M3(ctx);
  await tresorerieV2M3(ctx);
  await causesV1M3(ctx);
  await creanciersAccordsM3(ctx);
  await diagnosticMaiM3(ctx);
  await planVague2M3(ctx);
  await paiementsM3(ctx);
  await covenantsV1M3(ctx);
  await recalibrerIndustrie2025(ctx);
  await tresorerieV3M3(ctx);
  await financementV1M3(ctx);
  await diagnosticJuilletM3(ctx);
  await tresorerieV4M3(ctx);
  await planVersion3M3(ctx);
  await causesV2M3(ctx);
  await conformiteFinM3(ctx);
  await diagnosticFinM3(ctx);
  await clotureM3(ctx);
  await suiviM3(ctx);
}
