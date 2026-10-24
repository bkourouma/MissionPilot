import type { ContexteTenantDemo } from "../contexte.js";
import { semerCasting } from "../missions/orchestration.js";
import { semerPipelineComplementaire } from "../missions/pipeline.js";

/*
 * Phase « missions » du seed « Tenant démo » : casting des 11 missions (voir
 * missions/donnees-casting.ts) créées par les vraies routes, du pipeline commercial à la
 * signature, au démarrage et, pour les missions terminées, à l'état « à clôturer ».
 * La clôture elle-même (missions/cloture.ts) vient APRÈS les phases de temps, de facturation et
 * d'encaissement : une mission clôturée refuse toute écriture. Le pipeline commercial
 * complémentaire (opportunités perdues ou ouvertes) suit le casting.
 */
export async function semerMissions(ctx: ContexteTenantDemo): Promise<void> {
  await semerCasting(ctx);
  await semerPipelineComplementaire(ctx);
}
