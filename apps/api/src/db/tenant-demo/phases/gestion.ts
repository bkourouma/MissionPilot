import type { ContexteTenantDemo } from "../contexte.js";
import { lireCasting } from "../gestion/casting.js";
import { alignerDatesActions } from "../gestion/alignement-dates.js";
import { semerCollaboration } from "../gestion/collaboration.js";
import { semerFacturation } from "../gestion/facturation.js";
import { semerIngestion } from "../gestion/ingestion.js";
import { signerRapportsTerminees } from "../gestion/qualite-rapports.js";
import { semerRapports } from "../gestion/rapports.js";
import { semerSalleMission } from "../gestion/salle-mission.js";
import { semerTemps } from "../gestion/temps.js";
import { semerRevuesFroides } from "../ia-qualite-standard/qualite-froide.js";
import { cloturerMissionsTerminees } from "../missions/cloture.js";

/*
 * Phase « gestion » du seed « Tenant démo » (lot 2b, dernière phase) : temps, facturation et
 * encaissements, rapports, salle de mission, ingestion, collaboration et portail, puis clôture
 * des 5 missions terminées. Les modules vivent dans `gestion/` (un fichier par domaine).
 *
 * ORDRE IMPOSÉ : le temps d'abord (les périodes se clôturent), puis la facturation (la régie
 * facture le temps validé), puis rapports, salle de mission, ingestion et collaboration, puis la signature qualité des rapports des missions terminées
 * (leur clôture exige des livrables signés) ; enfin la
 * clôture des missions terminées (lot 2a : elle exige temps validés, factures émises et soldées,
 * livrables signés) puis les revues à froid de la qualité (lot 6 : elles exigent ces clôtures).
 *
 * Reprise : chaque module relit l'existant et ne duplique rien ; la phase entière peut être rejouée
 * après un échec. Les missions du casting sont lues par leur intitulé exact (lot 2a).
 */
export async function semerGestion(ctx: ContexteTenantDemo): Promise<void> {
  const casting = await lireCasting(ctx);
  if (casting.absentes.length > 0) {
    ctx.journal(
      `Gestion : missions absentes du casting (${casting.absentes.join(", ")}) : exécuter d'abord la phase « missions ».`,
    );
  }
  await semerTemps(ctx, casting);
  await semerFacturation(ctx, casting);
  await semerRapports(ctx, casting);
  await semerSalleMission(ctx, casting);
  await semerIngestion(ctx, casting);
  await semerCollaboration(ctx, casting);
  await signerRapportsTerminees(ctx, casting);
  await cloturerMissionsTerminees(ctx);
  await semerRevuesFroides(ctx);
  // Dernière étape : dates d'action de la phase ramenées avant la clôture des missions terminées.
  await alignerDatesActions(ctx);
}
