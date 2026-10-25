import type { ContexteTenantDemo } from "../contexte.js";

/*
 * Datation des rapports générés. La route horodate le rapport « maintenant » : le NOM du fichier
 * (« État d'avancement 2026-10-25.pdf »), sa date de dépôt et le libellé du suivi qualité ouvert
 * (« … du 25/10/2026 ») portent alors le jour de l'exécution du seed, y compris pour un rapport
 * d'une mission de 2025 dont `genere_le` a été remonté. Ces trois éléments sont ramenés au jour
 * fictif de génération (`rapports_mission.genere_le`), pour TOUS les rapports du cabinet (ceux des
 * autres lots aussi). Une transaction du propriétaire, rôle `replica` le temps de la transaction
 * (comme `appliquerSql` du lot 4), requêtes littérales filtrées par cabinet ; seuls des noms
 * horodatés et des dates changent, jamais le contenu du fichier. Idempotent.
 */
export async function daterRapports(ctx: ContexteTenantDemo): Promise<number> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    // 1. Libellé du suivi qualité : doit être lu AVANT le changement de date du fichier.
    await c.query(
      `UPDATE qualite_suivis s SET libelle = replace(
           s.libelle,
           to_char(f.cree_le AT TIME ZONE 'UTC', 'DD/MM/YYYY'),
           to_char(r.genere_le AT TIME ZONE 'UTC', 'DD/MM/YYYY'))
         FROM rapports_mission r JOIN fichiers f ON f.id = r.fichier_id
        WHERE s.cabinet_id = $1 AND s.type_livrable = 'rapport' AND s.livrable_id = r.id
          AND (f.cree_le AT TIME ZONE 'UTC')::date <> (r.genere_le AT TIME ZONE 'UTC')::date`,
      [ctx.cabinetId],
    );
    // 2. Nom du fichier et date de dépôt.
    const r = await c.query(
      `UPDATE fichiers f SET
           nom_origine = replace(
             f.nom_origine,
             to_char(f.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
             to_char(r.genere_le AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
           cree_le = r.genere_le
         FROM rapports_mission r
        WHERE f.cabinet_id = $1 AND r.fichier_id = f.id
          AND (f.cree_le AT TIME ZONE 'UTC')::date <> (r.genere_le AT TIME ZONE 'UTC')::date`,
      [ctx.cabinetId],
    );
    await c.query("COMMIT");
    return r.rowCount ?? 0;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
