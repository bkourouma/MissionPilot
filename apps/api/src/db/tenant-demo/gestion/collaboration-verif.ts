import type { ContexteTenantDemo } from "../contexte.js";

/*
 * Relevé des tables du schéma public encore VIDES en fin de module, classées par responsable
 * pour que l'exploitant sache d'un coup d'œil si un vide est voulu. Lecture seule (SQL du
 * propriétaire). Le comptage utilise `query_to_xml` avec `%I` : le nom de table vient du
 * catalogue, jamais d'une entrée extérieure.
 */

/** Techniques ou d'exploitation : volontairement jamais semées. */
const EXCLUES =
  /^(tentatives_auth|saisies_idempotence|defis_2fa|plateforme_sessions|journal_plateforme|ia_reservations|ia_cache_reponses|canaux_evenements_recus|ia_alertes_plafond|super_admins)|_coupe_circuit/;
/** Semées par les autres modules de la phase `gestion` (temps, facturation, rapports, salle, ingestion, qualité). */
const AUTRES_MODULES_GESTION =
  /^(salle_|ingestion_|rapports_|bilans_mission|qualite_froide_|periodes_temps|corrections_temps|feuilles_temps|lignes_temps|feuille_validations|rappels_temps|reste_a_faire|alertes_suivi|factures|encaissements|debours|relances|plan_comptable|ecritures|avoirs|echeances_facturation|echeance_temps|paiements|imputations|contre_passations|facturation_|facture_|parametres_relances|sequences_facturation)/;
/** Lot notation, plans, KPI, questionnaires (non fusionné au moment de ce module). */
const LOT_NOTATION = /^(notation|plan_|plans_|kpi_|questionnaire|initiative_type_observations)/;

export async function journalTablesVides(ctx: ContexteTenantDemo): Promise<string[]> {
  const r = await ctx.proprietaire.query(
    `SELECT t.table_name AS nom,
            (xpath('/row/cnt/text()', query_to_xml(
               format('SELECT count(*) AS cnt FROM public.%I', t.table_name), false, true, '')))[1]::text::int AS n
       FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name`,
  );
  const vides = (r.rows as { nom: string; n: number }[]).filter((x) => x.n === 0).map((x) => x.nom);
  const classer = (nom: string): string =>
    EXCLUES.test(nom)
      ? "exclue"
      : AUTRES_MODULES_GESTION.test(nom)
        ? "autre module gestion"
        : LOT_NOTATION.test(nom)
          ? "lot notation/plans/KPI"
          : "NON ATTRIBUÉE";
  const parClasse = new Map<string, string[]>();
  for (const nom of vides)
    parClasse.set(classer(nom), [...(parClasse.get(classer(nom)) ?? []), nom]);
  ctx.journal(`  tables vides en fin de module : ${vides.length} sur ${r.rows.length}.`);
  for (const [classe, noms] of parClasse) ctx.journal(`    [${classe}] ${noms.join(", ")}`);
  return vides;
}
