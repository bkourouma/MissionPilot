import { maintenirIngestion } from "../../../ingestion/maintenance.js";
import type { ContexteTenantDemo } from "../contexte.js";
import type { Casting } from "./casting.js";
import { semerEtatsDocuments } from "./ingestion-etats.js";
import { semerLecturesDd, semerStandardHistorique } from "./ingestion-lectures.js";
import { antedaterPurge } from "./ingestion-outils.js";

/*
 * MODULE INGESTION de la phase `gestion` du Tenant démo (DOS-03, DD-02, DD-10, STD-13) : documents du
 * cabinet lus puis soumis à validation. Tout passe par les routes et les jobs réels (voir les
 * fichiers ingestion-*.ts), sans clé d'IA ni OCR :
 *  1. états financiers lus dans des TABLEURS (règles du moteur) : acceptés automatiquement, tranchés
 *     en revue par une personne autre que l'importateur, rejetés puis corrigés ;
 *  2. rapports et salle de données de DUE DILIGENCE (si la mission a un dossier de due diligence) :
 *     brouillon d'un gabarit déterministe, validé, rejeté ou laissé en attente par un expert autre
 *     que le téléverseur ;
 *  3. documents historiques du STANDARD (méthode brouillon du cabinet).
 * Puis la MAINTENANCE réelle de l'ingestion (fonction `maintenirIngestion`, purge du texte des pages
 * 90 jours après la dernière décision) s'applique aux documents anciens ; la date de purge est ramenée
 * à sa valeur fictive. Idempotent : un document se retrouve par (usage, nom, portée) ; les dates sont
 * remontées par SQL littéral (déclencheurs d'identité désactivés le temps d'une transaction).
 * LIMITE : les montants des états sont ceux du tableur (jeu de démonstration), pas d'un modèle.
 */

async function purger(ctx: ContexteTenantDemo): Promise<number> {
  const bilan = await ctx.database.withTenant(ctx.cabinetId, (db) =>
    maintenirIngestion(db, ctx.config, ctx.cabinetId, new Date()),
  );
  const purges = await ctx.proprietaire.query(
    `SELECT id,
            to_char(greatest(termine_le, coalesce((SELECT max(x.valide_le) FROM ingestion_extractions x
                                                    WHERE x.document_id = d.id), termine_le)), 'YYYY-MM-DD') AS depuis
       FROM ingestion_documents d
      WHERE cabinet_id = $1 AND texte_purge_le IS NOT NULL AND texte_purge_le > now() - interval '1 day'`,
    [ctx.cabinetId],
  );
  for (const l of purges.rows) await antedaterPurge(ctx, l.id as string, l.depuis as string);
  // Passage de la maintenance (03:45 UTC du jour fictif) : sa ligne de journal prend cette date.
  await ctx.proprietaire.query(
    `UPDATE journal_audit SET cree_le = $2::timestamptz
      WHERE cabinet_id = $1 AND action = 'ingestion.maintenance' AND cree_le > now() - interval '5 minutes'`,
    [ctx.cabinetId, `${ctx.aujourdhui}T03:45:00Z`],
  );
  return bilan.documents_purges;
}

export async function semerIngestion(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  ctx.journal("[ingestion] états financiers en tableur…");
  const etats = await semerEtatsDocuments(ctx, casting);
  ctx.journal("[ingestion] rapports et salle de données de due diligence…");
  const dd = await semerLecturesDd(ctx, casting);
  ctx.journal("[ingestion] documents historiques du standard…");
  const standard = await semerStandardHistorique(ctx);
  const purges = await purger(ctx);
  ctx.journal(
    `[ingestion] documents traités : états ${etats}, due diligence ${dd}, standard ${standard} ; textes purgés : ${purges}`,
  );
}
