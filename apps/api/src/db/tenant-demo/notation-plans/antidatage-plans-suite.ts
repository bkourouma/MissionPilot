import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre } from "./antidatage.js";
import type { FenetresPlan } from "./antidatage-plans.js";

/*
 * Fin de l'antidatage d'un plan :
 *  - lien du diagnostic à la notation publiée (plan_diagnostic_notations.lie_le) puis partage au
 *    client (plans_strategiques.partage_le, plan 1 seulement) : la route de lien retire le partage
 *    et le directeur le rétablit, donc partage ≥ lien ≥ publication de la notation. La publication
 *    de la notation est antidatée par l'étape « notations » ; si elle tombe dans la période du plan
 *    (et seulement alors) elle sert de plancher au lien ;
 *  - plan vivant : réalisés et re-prévisions (instants de SAISIE) puis explications IA des
 *    re-prévisions. Les dates métier (exercice, trimestre) ne bougent pas : un trimestre postérieur
 *    à la fin de la mission est saisi au plus tard à fin + 3 jours (incohérence de scénario).
 */

export async function antidaterDiagnosticEtPartage(
  ctx: ContexteTenantDemo,
  planId: string,
  f: FenetresPlan,
): Promise<void> {
  await etalerSurFenetre(
    ctx,
    [
      {
        select:
          "SELECT id, lie_le AS t FROM plan_diagnostic_notations WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_diagnostic_notations SET lie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.diagnostic.debut,
    f.diagnostic.fin,
  );
  await etalerSurFenetre(
    ctx,
    [
      {
        select:
          "SELECT id, partage_le AS t FROM plans_strategiques WHERE cabinet_id = $1 AND id = $2 AND partage_le IS NOT NULL",
        params: [planId],
        update:
          "UPDATE plans_strategiques SET partage_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.partage.debut,
    f.partage.fin,
  );
  // Plancher : publication de la notation liée + 1 h, si elle tombe dans la période du plan.
  await appliquerSql(
    ctx,
    `UPDATE plan_diagnostic_notations d
        SET lie_le = LEAST($4::timestamptz, GREATEST(d.lie_le, pub.t + interval '1 hour'))
       FROM (SELECT e.version_id, max(e.le) AS t FROM notation_evenements e
              WHERE e.cabinet_id = $1 AND e.action = 'publication' GROUP BY e.version_id) pub
      WHERE d.cabinet_id = $1 AND d.plan_id = $2 AND pub.version_id = d.notation_version_id
        AND pub.t BETWEEN $3::timestamptz AND $4::timestamptz`,
    [ctx.cabinetId, planId, f.creation.debut, f.partage.fin],
  );
  // Un partage ne précède jamais le dernier lien du diagnostic.
  await appliquerSql(
    ctx,
    `UPDATE plans_strategiques p
        SET partage_le = LEAST($3::timestamptz, GREATEST(p.partage_le, l.t + interval '1 hour'))
       FROM (SELECT plan_id, max(lie_le) AS t FROM plan_diagnostic_notations
              WHERE cabinet_id = $1 GROUP BY plan_id) l
      WHERE p.cabinet_id = $1 AND p.id = $2 AND p.partage_le IS NOT NULL AND l.plan_id = p.id`,
    [ctx.cabinetId, planId, f.plafond],
  );
}

export async function antidaterVivant(
  ctx: ContexteTenantDemo,
  planId: string,
  f: FenetresPlan,
): Promise<void> {
  await etalerSurFenetre(
    ctx,
    [
      {
        select: "SELECT id, cree_le AS t FROM plan_realises WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_realises SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, cree_le AS t FROM plan_reprevisions WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_reprevisions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.vivant.debut,
    f.vivant.fin,
  );
  // Explications IA des re-prévisions : 10 minutes après la re-prévision, terminées 1 minute plus tard.
  await appliquerSql(
    ctx,
    `UPDATE ia_demandes d
        SET cree_le = x.t,
            termine_le = CASE WHEN d.termine_le IS NULL THEN NULL ELSE x.t + interval '1 minute' END
       FROM (SELECT d2.id,
                    r.cree_le + row_number() OVER (PARTITION BY r.id ORDER BY d2.cree_le, d2.id)
                                * interval '10 minutes' AS t
               FROM ia_demandes d2
               JOIN plan_reprevisions r ON r.id = d2.entite_id AND r.cabinet_id = d2.cabinet_id
              WHERE d2.cabinet_id = $1 AND d2.entite_type = 'plan_reprevision' AND r.plan_id = $2) x
      WHERE d.id = x.id AND d.cabinet_id = $1`,
    [ctx.cabinetId, planId],
  );
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
               JOIN plan_reprevisions r ON r.id = dm.entite_id AND r.cabinet_id = dm.cabinet_id
              WHERE g2.cabinet_id = $1 AND dm.entite_type = 'plan_reprevision' AND r.plan_id = $2) x
      WHERE g.id = x.id AND g.cabinet_id = $1`,
    [ctx.cabinetId, planId],
  );
}
