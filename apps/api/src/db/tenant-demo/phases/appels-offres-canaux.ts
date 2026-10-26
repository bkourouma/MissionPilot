import { semerBanqueAo } from "../appels-offres-canaux/ao-banque.js";
import { semerFichesAo } from "../appels-offres-canaux/ao-fiches.js";
import { semerVeilleAo } from "../appels-offres-canaux/ao-veille.js";
import { semerCanaux } from "../appels-offres-canaux/canaux.js";
import { semerCapitalisation } from "../appels-offres-canaux/capitalisation.js";
import { semerObservatoire } from "../appels-offres-canaux/observatoire.js";
import { semerServicesCandidats } from "../appels-offres-canaux/services-candidats.js";
import { refuserCleIa } from "../appels-offres-canaux/outils.js";
import type { ContexteTenantDemo } from "../contexte.js";

/*
 * Phase « appels-offres-canaux » du seed « Tenant démo » (lot 5) : appels d'offres et banque
 * d'AO, veille simulée, canaux simulés (WhatsApp, e-mail, signature, transcription), capitalisation
 * et observatoire, services candidats et guichets de financement.
 *
 * Phase mince : chaque module de `appels-offres-canaux/` est idempotent par clé naturelle (une
 * phase échouée est rejouée en entier). Les missions viennent du casting du lot 2a (outils.ts).
 * L'ordre compte : les fiches d'AO avant la banque d'AO et la veille ; les canaux avant la
 * capitalisation (les KPI et les missions terminées existent déjà).
 */
export const MODULES_APPELS_OFFRES_CANAUX = [
  ["ao-fiches", semerFichesAo],
  ["ao-banque", semerBanqueAo],
  ["ao-veille", semerVeilleAo],
  ["canaux", semerCanaux],
  ["capitalisation", semerCapitalisation],
  ["observatoire", semerObservatoire],
  ["services-candidats", semerServicesCandidats],
] as const;

export async function semerAppelsOffresCanaux(ctx: ContexteTenantDemo): Promise<void> {
  refuserCleIa(ctx);
  for (const [nom, semer] of MODULES_APPELS_OFFRES_CANAUX) {
    ctx.journal(`  appels-offres-canaux : ${nom}…`);
    await semer(ctx);
  }
}
