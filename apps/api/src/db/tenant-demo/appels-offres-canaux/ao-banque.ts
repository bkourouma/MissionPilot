import type { ContexteTenantDemo } from "../contexte.js";
import { semerCv } from "./ao-banque-cv.js";
import { semerOffresFinancieres } from "./ao-banque-financieres.js";
import { semerOffresTechniques } from "./ao-banque-offres.js";
import { semerReferences } from "./ao-banque-references.js";

/*
 * Banque d'AO du Tenant démo : CV (versions, contrôle, anonymisation), références et attestations
 * (dont une pièce retirée), offres techniques (brouillon IA simulé, version humaine, validation par
 * un tiers) et offres financières (moteur, versions, FIN-02). Doit passer APRÈS « ao-fiches » :
 * les offres se rattachent aux fiches d'appels d'offres. Rejouable sans doublon.
 */
export async function semerBanqueAo(ctx: ContexteTenantDemo): Promise<void> {
  const cvIds = await semerCv(ctx);
  await semerReferences(ctx);
  await semerOffresTechniques(ctx, cvIds);
  await semerOffresFinancieres(ctx, cvIds);
}
