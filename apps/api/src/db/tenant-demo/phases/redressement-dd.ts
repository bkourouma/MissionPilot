import type { ContexteTenantDemo } from "../contexte.js";
import {
  etape,
  MISSIONS_TERMINEES,
  retirerEquipesAjoutees,
  trouverMission,
} from "../redressement-dd/commun.js";
import { semerDueDiligence } from "../redressement-dd/due-diligence.js";
import { semerParametresPortail } from "../redressement-dd/portail.js";
import { semerPreuves } from "../redressement-dd/preuves.js";
import { semerRedressement } from "../redressement-dd/redressement.js";

/*
 * Phase « redressement-dd » du seed « Tenant démo » : preuves et assertions (missions 1 à 5),
 * redressement (missions 3 terminée et 7 en cours), due diligence (missions 4 terminée et 11 en
 * préparation), paramètres du portail. Les missions viennent de la phase « missions » (noms exacts,
 * redressement-dd/commun.ts). Ordre : les preuves d'abord (la due diligence cite des assertions).
 * Les comptes ajoutés aux équipes des missions terminées pour écrire sont retirés en fin de phase.
 * Chaque étape est marquée au journal d'audit : une relance saute ce qui est fait.
 */
export async function semerRedressementDd(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "preuves", () => semerPreuves(ctx));
  await etape(ctx, "redressement", () => semerRedressement(ctx));
  await etape(ctx, "due-diligence", () => semerDueDiligence(ctx));
  await etape(ctx, "portail-parametres", () => semerParametresPortail(ctx));
  // Missions terminées : l'équipe redevient celle du casting (relecteurs hors équipe, QUA-05).
  await etape(ctx, "equipes-terminees", async () => {
    const ids: string[] = [];
    for (const nom of MISSIONS_TERMINEES) ids.push((await trouverMission(ctx, nom)).id);
    const n = await retirerEquipesAjoutees(ctx, ids);
    ctx.journal(`  ${n} ajout(s) d'équipe retiré(s) des missions terminées.`);
  });
}
