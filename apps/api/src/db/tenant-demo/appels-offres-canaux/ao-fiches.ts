import type { ContexteTenantDemo } from "../contexte.js";
import { semerEnCours } from "./ao-fiches-encours.js";
import { historiser } from "./ao-fiches-historique.js";
import { APPELS_OFFRES_DEMO } from "./donnees-ao-liste.js";
import { SCENARIOS_AO } from "./donnees-ao-scenarios.js";
import { sql } from "./outils.js";

/*
 * Fiches d'appels d'offres de la banque d'AO (7 appels d'offres sur deux ans) : fiche, historique
 * de statuts, go/no-go, décision de l'associé, dossier, extraction, matrice, rétro-planning.
 *
 * - Appels d'offres clos : écrits en SQL propriétaire à leur date fictive (`ao-fiches-historique.ts`),
 *   car les routes écrivent `now()` et les historiques sont en ajout seul.
 * - Appel d'offres en cours : écrit par les routes (`ao-fiches-encours.ts`).
 * Idempotent (clé : référence). Se termine par un contrôle FIN-02 de la lecture du go/no-go.
 */

const MARQUES_MARGE = ["marge_estimee_bp", "marge_cible_bp", "marge_renseignee", '"marge"'];

/** Un compte sans `finance.lire` ne doit voir AUCUNE marge ; un compte financier la voit. */
async function controlerFinance(ctx: ContexteTenantDemo, aoId: string, reference: string) {
  for (const cle of ["directeur.mission", "chef.mission"] as const) {
    const r = await ctx.session(cle).get(`/api/appels-offres/${aoId}/go-no-go`);
    if (r.statusCode !== 200) {
      throw new Error(`go/no-go ${reference} illisible par ${cle} (${r.statusCode}).`);
    }
    const fuite = MARQUES_MARGE.find((m) => r.body.includes(m));
    if (fuite)
      throw new Error(`FIN-02 : la lecture de ${reference} par ${cle} expose « ${fuite} ».`);
  }
  const financier = await ctx.session("gestionnaire").get(`/api/appels-offres/${aoId}/go-no-go`);
  if (financier.statusCode !== 200) {
    throw new Error(`go/no-go ${reference} illisible par le gestionnaire.`);
  }
}

export async function semerFichesAo(ctx: ContexteTenantDemo): Promise<void> {
  for (const ao of APPELS_OFFRES_DEMO) {
    if (ao.issue === "en_cours") {
      await semerEnCours(ctx, ao);
      continue;
    }
    const scenario = SCENARIOS_AO.find((s) => s.cle === ao.cle);
    if (!scenario) throw new Error(`Aucun scénario pour l'appel d'offres « ${ao.cle} ».`);
    if (await historiser(ctx, ao, scenario))
      ctx.journal(`  appel d'offres ${ao.reference} historisé.`);
  }
  for (const ao of APPELS_OFFRES_DEMO) {
    const ligne = (
      await sql<{ id: string }>(
        ctx,
        "SELECT id FROM appels_offres WHERE lower(reference) = lower($1)",
        [ao.reference],
      )
    )[0];
    if (!ligne) throw new Error(`Appel d'offres ${ao.reference} absent après semis.`);
    await controlerFinance(ctx, ligne.id, ao.reference);
  }
}
