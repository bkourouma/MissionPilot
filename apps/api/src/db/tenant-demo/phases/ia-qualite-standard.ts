import type { ContexteTenantDemo } from "../contexte.js";
import { MODULES } from "../ia-qualite-standard/modules.js";

/*
 * Phase « ia-qualite-standard » du seed « Tenant démo » : standard et méthodes, IA, agents,
 * copilote, automatisation, avancement et qualité (49 tables ; voir l'inventaire des tables).
 *
 * Mince : chaque domaine vit dans `tenant-demo/ia-qualite-standard/` et se rejoue sans doublon.
 * Les missions du casting (phase « missions ») sont retrouvées par intitulé exact. Aucune clé IA,
 * aucun appel réseau : l'IA est simulée (gabarit déterministe, fournisseur local de test).
 */
export async function semerIaQualiteStandard(ctx: ContexteTenantDemo): Promise<void> {
  for (const [nom, module] of Object.entries(MODULES)) {
    ctx.journal(`  module « ${nom} »`);
    await module(ctx);
  }
}
