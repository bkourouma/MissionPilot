import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre } from "./antidatage.js";
import type { FenetresPlan } from "./antidatage-plans.js";

/*
 * Antidatage des ateliers d'un plan : création, options, invitations, ouverture, contributions,
 * clôture et dernière modification, dans leur ordre d'écriture réel (ouverture < contributions <
 * clôture). Puis les explications de synthèse produites par l'IA (ia_demandes, ia_generations),
 * retrouvées par le lien `entite_type = 'plan_atelier'` + `entite_id` : elles suivent la dernière
 * modification de l'atelier (la synthèse est rédigée une fois l'atelier clos). Les lignes de
 * contribution n'ont aucun instant. Le premier SELECT de chaque source porte `$2` = plan.
 */

const parAtelier = (colonne: string): string =>
  `SELECT id, ${colonne} AS t FROM plan_ateliers WHERE cabinet_id = $1 AND plan_id = $2`;

export async function antidaterAteliers(
  ctx: ContexteTenantDemo,
  planId: string,
  f: FenetresPlan,
): Promise<void> {
  await etalerSurFenetre(
    ctx,
    [
      {
        select: parAtelier("cree_le"),
        params: [planId],
        update:
          "UPDATE plan_ateliers SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT o.id, o.cree_le AS t FROM plan_atelier_options o
                   JOIN plan_ateliers a ON a.id = o.atelier_id AND a.cabinet_id = o.cabinet_id
                  WHERE o.cabinet_id = $1 AND a.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_atelier_options SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT p.id, p.invite_le AS t FROM plan_atelier_participants p
                   JOIN plan_ateliers a ON a.id = p.atelier_id AND a.cabinet_id = p.cabinet_id
                  WHERE p.cabinet_id = $1 AND a.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_atelier_participants SET invite_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `${parAtelier("ouvert_le")} AND ouvert_le IS NOT NULL`,
        params: [planId],
        update:
          "UPDATE plan_ateliers SET ouvert_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT c.id, c.depose_le AS t FROM plan_atelier_contributions c
                   JOIN plan_ateliers a ON a.id = c.atelier_id AND a.cabinet_id = c.cabinet_id
                  WHERE c.cabinet_id = $1 AND a.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_atelier_contributions SET depose_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `${parAtelier("clos_le")} AND clos_le IS NOT NULL`,
        params: [planId],
        update:
          "UPDATE plan_ateliers SET clos_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: parAtelier("modifie_le"),
        params: [planId],
        update:
          "UPDATE plan_ateliers SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.ateliers.debut,
    f.ateliers.fin,
  );

  // Demandes d'IA de synthèse : 10 minutes après la dernière modification de l'atelier (une
  // demande de plus = 10 minutes de plus), terminées une minute plus tard.
  await appliquerSql(
    ctx,
    `UPDATE ia_demandes d
        SET cree_le = x.t,
            termine_le = CASE WHEN d.termine_le IS NULL THEN NULL ELSE x.t + interval '1 minute' END
       FROM (SELECT d2.id,
                    a.modifie_le + row_number() OVER (PARTITION BY a.id ORDER BY d2.cree_le, d2.id)
                                   * interval '10 minutes' AS t
               FROM ia_demandes d2
               JOIN plan_ateliers a ON a.id = d2.entite_id AND a.cabinet_id = d2.cabinet_id
              WHERE d2.cabinet_id = $1 AND d2.entite_type = 'plan_atelier' AND a.plan_id = $2) x
      WHERE d.id = x.id AND d.cabinet_id = $1`,
    [ctx.cabinetId, planId],
  );
  // Générations : après la fin de la demande, une minute d'écart par version.
  await appliquerSql(
    ctx,
    `UPDATE ia_generations g
        SET cree_le = x.t
       FROM (SELECT g2.id,
                    COALESCE(dm.termine_le, dm.cree_le)
                      + row_number() OVER (PARTITION BY g2.demande_id ORDER BY g2.version, g2.id)
                        * interval '1 minute' AS t
               FROM ia_generations g2
               JOIN ia_demandes dm ON dm.id = g2.demande_id AND dm.cabinet_id = g2.cabinet_id
               JOIN plan_ateliers a ON a.id = dm.entite_id AND a.cabinet_id = dm.cabinet_id
              WHERE g2.cabinet_id = $1 AND dm.entite_type = 'plan_atelier' AND a.plan_id = $2) x
      WHERE g.id = x.id AND g.cabinet_id = $1`,
    [ctx.cabinetId, planId],
  );
}
