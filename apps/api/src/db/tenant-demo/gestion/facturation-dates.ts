import type { ContexteTenantDemo } from "../contexte.js";

/*
 * ANTIDATAGE des horodatages de la facturation. Les routes et les fonctions de domaine posent
 * « maintenant » la création, la soumission, l'approbation et l'émission des factures (la DATE
 * d'émission, elle, est fictive), les saisies d'encaissement, les imputations, les relances, les
 * débours et les échéances ; plusieurs de ces colonnes sont figées par déclencheur. Le client verrait
 * des factures de 2024 « créées » en octobre 2026. Une transaction du propriétaire, sous le rôle
 * `replica` le temps de la transaction (comme `appliquerSql` du lot 4), remonte ces seules DATES à
 * partir des dates métier déjà fictives (`date_emission`, `date_encaissement`, `date_imputation`,
 * `date_relance`, `date` du débours, signature de la mission). Requêtes littérales, filtrées par
 * cabinet ; le contenu (montants, statuts, liens) n'est jamais modifié. Idempotent : les valeurs
 * visées ne dépendent que des dates métier.
 */

export async function antedaterFacturation(ctx: ContexteTenantDemo): Promise<void> {
  const c = ctx.proprietaire;
  const p = [ctx.cabinetId];
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    // Factures et avoirs émis ou annulés : création, soumission, approbation, émission, envoi.
    await c.query(
      `UPDATE factures f SET
         cree_le = f.date_emission::timestamptz - interval '2 days' + interval '9 hours',
         soumise_le = f.date_emission::timestamptz - interval '1 day' + interval '10 hours',
         approuvee_le = f.date_emission::timestamptz - interval '1 day' + interval '15 hours',
         emise_le = f.date_emission::timestamptz + interval '10 hours',
         envoyee_le = CASE WHEN f.envoyee_le IS NULL THEN NULL
                           ELSE f.date_emission::timestamptz + interval '11 hours' END,
         annulee_le = CASE WHEN f.annulee_le IS NULL THEN NULL
                           ELSE coalesce(
                             (SELECT a.date_emission::timestamptz + interval '11 hours'
                                FROM factures a WHERE a.id = f.annulee_par_avoir_id),
                             f.annulee_le) END,
         modifie_le = coalesce(
                        (SELECT a.date_emission::timestamptz + interval '11 hours'
                           FROM factures a WHERE a.id = f.annulee_par_avoir_id),
                        f.date_emission::timestamptz + interval '11 hours')
       WHERE f.cabinet_id = $1 AND f.statut IN ('emise', 'annulee') AND f.date_emission IS NOT NULL
         AND f.soumise_le IS NOT NULL AND f.approuvee_le IS NOT NULL`,
      p,
    );
    // Encaissements, imputations, relances manuelles.
    await c.query(
      `UPDATE encaissements SET saisi_le = date_encaissement::timestamptz + interval '10 hours'
        WHERE cabinet_id = $1`,
      p,
    );
    await c.query(
      `UPDATE imputations SET cree_le = date_imputation::timestamptz + interval '10 hours 5 minutes'
        WHERE cabinet_id = $1`,
      p,
    );
    await c.query(
      `UPDATE relances_factures SET cree_le = date_relance::timestamptz + interval '9 hours 30 minutes'
        WHERE cabinet_id = $1`,
      p,
    );
    await c.query(
      `UPDATE contre_passations x SET
         demandee_le = e.date_encaissement::timestamptz + interval '1 day' + interval '10 hours',
         decidee_le = CASE WHEN x.decidee_le IS NULL THEN NULL
                           ELSE e.date_encaissement::timestamptz + interval '2 days' + interval '11 hours' END
         FROM encaissements e
        WHERE x.cabinet_id = $1 AND e.id = x.encaissement_id`,
      p,
    );
    // Débours : saisie, soumission, décision.
    await c.query(
      `UPDATE debours d SET
         cree_le = d.date::timestamptz + interval '9 hours',
         soumis_le = CASE WHEN d.soumis_le IS NULL THEN NULL
                          ELSE d.date::timestamptz + interval '1 day' + interval '10 hours' END,
         decide_le = CASE WHEN d.decide_le IS NULL THEN NULL
                          ELSE d.date::timestamptz + interval '3 days' + interval '10 hours' END,
         modifie_le = d.date::timestamptz + interval '3 days' + interval '10 hours'
       WHERE d.cabinet_id = $1 AND d.date < $2::date - 7`,
      [ctx.cabinetId, ctx.aujourdhui],
    );
    // Échéances : créées à la signature de la mission, modifiées à l'émission de leur facture.
    await c.query(
      `UPDATE echeances_facturation e SET
         cree_le = m.date_signature::timestamptz + interval '1 day' + interval '9 hours',
         modifie_le = greatest(
           m.date_signature::timestamptz + interval '1 day' + interval '9 hours',
           coalesce(
             (SELECT max(f.date_emission)::timestamptz + interval '10 hours'
                FROM facturation_liens l JOIN factures f ON f.id = l.facture_id
               WHERE l.echeance_id = e.id AND f.statut IN ('emise', 'annulee')),
             m.date_signature::timestamptz + interval '1 day' + interval '9 hours'))
       FROM missions m
       WHERE e.cabinet_id = $1 AND m.id = e.mission_id AND m.date_signature IS NOT NULL`,
      p,
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
