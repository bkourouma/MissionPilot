import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre, type SourceInstants } from "./antidatage.js";

/*
 * Antidatage des données de RÉFÉRENCE propres aux notations et aux questionnaires (grilles et
 * versions, banque d'items, paramètres, types d'initiatives, modèles et versions de
 * questionnaires, historique IA des questionnaires). Les routes les datent du jour du semis, donc
 * après les missions de 2025 qui les utilisent : elles sont étalées, dans leur ordre d'écriture,
 * entre le début d'activité du cabinet (13:00 UTC, après l'ouverture des premiers comptes) et la
 * veille du premier usage. Séances de calibrage et impacts d'initiatives : dans le temps long
 * (voir plus bas). Paramètres : $1 = cabinet.
 */

function maj(select: string, update: string): SourceInstants {
  return { select, update };
}

/** Sources de référence, dans l'ordre d'écriture de l'étape (référentiels puis questionnaires). */
const SOURCES_REFERENCE: readonly SourceInstants[] = [
  maj(
    "SELECT cabinet_id AS id, modifie_le AS t FROM notation_parametres WHERE cabinet_id = $1",
    "UPDATE notation_parametres SET modifie_le = $2::timestamptz WHERE cabinet_id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM notation_grilles WHERE cabinet_id = $1",
    "UPDATE notation_grilles SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM notation_grilles WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE notation_grilles SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM notation_grille_versions WHERE cabinet_id = $1",
    "UPDATE notation_grille_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM notation_grille_versions WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE notation_grille_versions SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, valide_le AS t FROM notation_grille_versions WHERE cabinet_id = $1 AND valide_le IS NOT NULL",
    "UPDATE notation_grille_versions SET valide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM notation_banque_items WHERE cabinet_id = $1",
    "UPDATE notation_banque_items SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM notation_banque_items WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE notation_banque_items SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, valide_le AS t FROM notation_banque_items WHERE cabinet_id = $1 AND valide_le IS NOT NULL",
    "UPDATE notation_banque_items SET valide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM notation_initiatives_types WHERE cabinet_id = $1",
    "UPDATE notation_initiatives_types SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM notation_initiatives_types WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE notation_initiatives_types SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM questionnaire_modeles WHERE cabinet_id = $1",
    "UPDATE questionnaire_modeles SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM questionnaire_modeles WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE questionnaire_modeles SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM questionnaire_versions WHERE cabinet_id = $1",
    "UPDATE questionnaire_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, modifie_le AS t FROM questionnaire_versions WHERE cabinet_id = $1 AND modifie_le IS NOT NULL",
    "UPDATE questionnaire_versions SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, valide_le AS t FROM questionnaire_versions WHERE cabinet_id = $1 AND valide_le IS NOT NULL",
    "UPDATE questionnaire_versions SET valide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  {
    // Demandes IA de l'historique des questionnaires : la demande et ses générations en un bloc.
    select: `SELECT d.id, d.cree_le AS t FROM ia_demandes d
              WHERE d.cabinet_id = $1
                AND d.id IN (SELECT h.demande_id FROM questionnaire_ia_historique h
                              WHERE h.cabinet_id = $1 AND h.demande_id IS NOT NULL)`,
    update: `WITH d AS (SELECT id, cree_le FROM ia_demandes WHERE id = $1 AND cabinet_id = $3),
                  gen AS (UPDATE ia_generations x
                             SET cree_le = $2::timestamptz + (x.cree_le - d.cree_le),
                                 texte_purge_le = $2::timestamptz + (x.texte_purge_le - d.cree_le)
                            FROM d
                           WHERE x.demande_id = d.id AND x.cabinet_id = $3)
             UPDATE ia_demandes
                SET termine_le = $2::timestamptz + (termine_le - cree_le), cree_le = $2::timestamptz
              WHERE id = $1 AND cabinet_id = $3`,
  },
  maj(
    "SELECT id, cree_le AS t FROM questionnaire_ia_historique WHERE cabinet_id = $1",
    "UPDATE questionnaire_ia_historique SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
];

/** Séance de calibrage : création, cotations, clôture (dans cet ordre d'écriture). */
const SOURCES_CALIBRAGE: readonly SourceInstants[] = [
  maj(
    "SELECT id, cree_le AS t FROM notation_calibrations WHERE cabinet_id = $1 AND id = $2",
    "UPDATE notation_calibrations SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cree_le AS t FROM notation_calibration_cotations WHERE cabinet_id = $1 AND calibration_id = $2",
    "UPDATE notation_calibration_cotations SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
  maj(
    "SELECT id, cloturee_le AS t FROM notation_calibrations WHERE cabinet_id = $1 AND id = $2 AND cloturee_le IS NOT NULL",
    "UPDATE notation_calibrations SET cloturee_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  ),
];

/**
 * Fenêtres des séances de calibrage, dans l'ordre de création : la première (fin 2025) est clôturée,
 * la seconde (troisième trimestre 2026) est en cours. Une séance de plus reprend la dernière.
 */
const FENETRES_CALIBRAGE: readonly [string, string][] = [
  ["2025-10-06T08:00:00Z", "2025-12-12T17:00:00Z"],
  ["2026-09-07T08:00:00Z", "2026-10-02T17:00:00Z"],
];

export async function antidaterReferences(
  ctx: ContexteTenantDemo,
  premierUsage: string,
): Promise<void> {
  const fin = new Date(Date.parse(premierUsage) - 86_400_000).toISOString();
  await etalerSurFenetre(ctx, SOURCES_REFERENCE, `${ctx.debut}T13:00:00Z`, fin);

  const seances = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM notation_calibrations WHERE cabinet_id = $1 ORDER BY cree_le, id",
    [ctx.cabinetId],
  );
  for (const [i, s] of seances.rows.entries()) {
    const [debut, finSeance] = FENETRES_CALIBRAGE[Math.min(i, FENETRES_CALIBRAGE.length - 1)] as [
      string,
      string,
    ];
    await etalerSurFenetre(
      ctx,
      SOURCES_CALIBRAGE.map((x) => ({ ...x, params: [s.id] })),
      debut,
      finSeance,
    );
  }

  // Impacts d'initiatives : saisis le jour observé (midi UTC), dans l'ordre des dates observées.
  await appliquerSql(
    ctx,
    `UPDATE notation_initiatives_impacts i
        SET cree_le = r.t
       FROM (SELECT id,
                    ((observe_le::timestamp + interval '12 hours')
                     + (row_number() OVER (ORDER BY observe_le, id) - 1) * interval '7 minutes')
                      AT TIME ZONE 'UTC' AS t
               FROM notation_initiatives_impacts WHERE cabinet_id = $1) r
      WHERE i.id = r.id AND i.cabinet_id = $1`,
    [ctx.cabinetId],
  );
}
