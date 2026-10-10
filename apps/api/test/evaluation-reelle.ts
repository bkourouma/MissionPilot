import type pg from "pg";

/*
 * Prépare, en propriétaire (hors API, données de test), une évaluation `openrouter` RÉUSSIE et
 * LÉGITIME aux yeux de la base (migration 0270) : demande de rejeu passée « en cours », un appel
 * `succes` inscrit par cas dans `ia_consommations`, évaluation née de cette demande, demande
 * terminée « reussie ». Un test qui a besoin d'une évaluation réelle passe par ici, jamais par un
 * INSERT « openrouter » forgé (que la base refuse, MPG09).
 */
export async function semerEvaluationOpenRouter(
  c: pg.Client,
  o: {
    cabinetId: string;
    jeuId: string;
    promptId: string;
    modele: string;
    utilisateurId: string;
    casTotal: number;
    tache?: string;
  },
): Promise<{ demandeId: string; evaluationId: string }> {
  const d = await c.query(
    `INSERT INTO agents_evaluations_demandes (cabinet_id, jeu_id, prompt_id, modele, cas_total,
       cout_estime_micro_usd, plafond_evaluation_micro_usd, demande_par)
     VALUES ($1, $2, $3, $4, $5, 0, 2000000, $6) RETURNING id`,
    [o.cabinetId, o.jeuId, o.promptId, o.modele, o.casTotal, o.utilisateurId],
  );
  const demandeId = d.rows[0].id as string;
  await c.query(
    "UPDATE agents_evaluations_demandes SET statut = 'en_cours', debut_le = now() WHERE id = $1",
    [demandeId],
  );
  await c.query(
    `INSERT INTO ia_consommations (cabinet_id, demande_id, evaluation_demande_id, mission_id, tache,
       modele, issue, source_cle, tokens_entree, tokens_sortie, cout_micro_usd, tarif_connu, duree_ms)
     SELECT $1, NULL, $2, NULL, $3, $4, 'succes', 'plateforme', 100, 20, 600, true, 5
     FROM generate_series(1, $5::int)`,
    [o.cabinetId, demandeId, o.tache ?? "redaction", o.modele, o.casTotal],
  );
  const e = await c.query(
    `INSERT INTO agents_evaluations (cabinet_id, jeu_id, prompt_id, modele, fournisseur, cas_total,
       cas_reussis, regressions, reussie, resultats, lance_par, statut, demande_id)
     VALUES ($1, $2, $3, $4, 'openrouter', $5, $5, 0, true, '[]', $6, 'reussie', $7) RETURNING id`,
    [o.cabinetId, o.jeuId, o.promptId, o.modele, o.casTotal, o.utilisateurId, demandeId],
  );
  const evaluationId = e.rows[0].id as string;
  await c.query(
    `UPDATE agents_evaluations_demandes
     SET statut = 'reussie', evaluation_id = $2, cas_traites = $3, termine_le = now() WHERE id = $1`,
    [demandeId, evaluationId, o.casTotal],
  );
  return { demandeId, evaluationId };
}
