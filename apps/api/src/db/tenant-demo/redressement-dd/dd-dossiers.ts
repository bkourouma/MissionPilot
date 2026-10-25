import type { ContexteTenantDemo } from "../contexte.js";
import { semerDdMboa } from "./dd-mboa.js";
import { semerReferentielDd } from "./dd-referentiel.js";
import { semerDdWouri } from "./dd-wouri.js";

/*
 * Due diligence, première moitié : dossiers et analyses (missions 4 et 11). Appelé par
 * `due-diligence.ts` AVANT les notes et le portail investisseur (autre exécutant), qui retrouvent
 * les dossiers par les routes. Ordre :
 *   1. référentiel du cabinet (modèles sectoriels, listes d'exclusion, signaux et leurs versions) ;
 *   2. dossier COMPLET de la mission 4 « Due diligence — Mboa Solaire » : cadrage en trois versions,
 *      chaîne de valeur, analyses sourcées par le registre des preuves, risques, constats de
 *      signaux, hypothèses liées aux assertions « Mboa Solaire : … », verdicts validés par un tiers,
 *      dimensionnements (moteur), filtrages E&S et décisions, ajustements tracés, plan des 100 jours ;
 *   3. dossier OUVERT de la mission 11 « Due diligence — Wouri Distribution » (en préparation) :
 *      cadrage en cours et éléments en brouillon, aucun verdict.
 * Tout passe par les vraies routes `/api/dd/**` avec les comptes qui ont les droits (consultants
 * pour l'écriture, experts et directeur pour la validation) ; les dates sont antidatées au calendrier
 * des missions (dd-outils.ts). Les missions 1 à 5 restent ouvertes pendant la phase.
 */
export async function semerDdDossiers(ctx: ContexteTenantDemo): Promise<void> {
  const ref = await semerReferentielDd(ctx);
  const dossierMboa = await semerDdMboa(ctx, ref);
  const dossierWouri = await semerDdWouri(ctx, ref);
  ctx.journal(`  DD : dossier Mboa ${dossierMboa}, dossier Wouri ${dossierWouri}.`);
}
