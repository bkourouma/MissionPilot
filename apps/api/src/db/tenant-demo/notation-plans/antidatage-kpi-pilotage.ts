import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre, sousFenetre } from "./antidatage.js";
import type { BornesKpi } from "./antidatage-kpi-instants.js";

/*
 * Antidatage du pilotage par KPI d'UNE mission terminée : arbres et nœuds, revues, décisions,
 * actions et leurs événements. Chronologie (tout ≤ plafond = fin de mission + 4 jours) :
 *   arbre (20 à 30 % de la période) ;
 *   revue créée 14 jours avant sa date prévue, TENUE à cette date (14 h UTC) ;
 *   décisions créées pendant la revue (10 minutes d'écart), actions de la revue juste après leur
 *   décision ; une action hors revue naît un jour après son alerte, sinon 21 jours avant son effet ;
 *   une action se termine à sa date d'effet (12 h), une décision à la date d'effet de ses actions
 *   (à défaut son échéance), 15 h ; la revue est CLÔTURÉE après la dernière décision (le lendemain
 *   9 h) ;
 *   les événements d'une action ou d'une décision sont répartis entre sa création et sa fin dans
 *   leur ordre d'écriture réel.
 * Requêtes littérales filtrées par `cabinet_id` ; $2 = mission, puis plancher et plafond (ou le
 * plafond seul en $3 quand le plancher ne sert pas).
 */

export async function antidaterPilotage(ctx: ContexteTenantDemo, b: BornesKpi): Promise<void> {
  const c2 = [ctx.cabinetId, b.mission.id];
  const pp = [ctx.cabinetId, b.mission.id, b.plafond];
  const p = [ctx.cabinetId, b.mission.id, b.plancher, b.plafond];
  const arbre = sousFenetre(b.mission, 0.2, 0.3);
  await etalerSurFenetre(
    ctx,
    [
      {
        select: "SELECT id, cree_le AS t FROM kpi_arbres WHERE cabinet_id = $1 AND mission_id = $2",
        params: [b.mission.id],
        update: "UPDATE kpi_arbres SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT n.id, n.cree_le AS t FROM kpi_arbre_noeuds n
                   JOIN kpi_arbres a ON a.id = n.arbre_id AND a.cabinet_id = n.cabinet_id
                  WHERE n.cabinet_id = $1 AND a.mission_id = $2`,
        params: [b.mission.id],
        update:
          "UPDATE kpi_arbre_noeuds SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, modifie_le AS t FROM kpi_arbres WHERE cabinet_id = $1 AND mission_id = $2",
        params: [b.mission.id],
        update:
          "UPDATE kpi_arbres SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT n.id, n.modifie_le AS t FROM kpi_arbre_noeuds n
                   JOIN kpi_arbres a ON a.id = n.arbre_id AND a.cabinet_id = n.cabinet_id
                  WHERE n.cabinet_id = $1 AND a.mission_id = $2`,
        params: [b.mission.id],
        update:
          "UPDATE kpi_arbre_noeuds SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    arbre.debut,
    arbre.fin,
  );

  // Revues : création, tenue ; décisions ; actions (création) ; puis les fins.
  await appliquerSql(
    ctx,
    `UPDATE kpi_revues
        SET cree_le = LEAST($4::timestamptz, GREATEST($3::timestamptz,
              ((date_prevue::timestamp - interval '14 days' + interval '8 hours') AT TIME ZONE 'UTC'))),
            tenue_le = CASE WHEN tenue_le IS NULL THEN NULL
              ELSE LEAST($4::timestamptz, (date_prevue::timestamp + interval '14 hours') AT TIME ZONE 'UTC') END
      WHERE cabinet_id = $1 AND mission_id = $2`,
    p,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_revue_decisions d
        SET cree_le = LEAST($3::timestamptz, COALESCE(r.tenue_le, r.cree_le) + d.numero * interval '10 minutes')
       FROM kpi_revues r
      WHERE d.cabinet_id = $1 AND r.cabinet_id = $1 AND r.id = d.revue_id AND r.mission_id = $2`,
    pp,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_actions a
        SET cree_le = LEAST($4::timestamptz, GREATEST($3::timestamptz, CASE
              WHEN a.decision_id IS NOT NULL THEN
                (SELECT dc.cree_le FROM kpi_revue_decisions dc WHERE dc.id = a.decision_id) + interval '5 minutes'
              WHEN a.revue_id IS NOT NULL THEN
                (SELECT r.tenue_le FROM kpi_revues r WHERE r.id = a.revue_id) + interval '20 minutes'
              WHEN a.alerte_id IS NOT NULL THEN
                (SELECT al.detectee_le FROM kpi_alertes al WHERE al.id = a.alerte_id) + interval '1 day'
              ELSE ((LEAST(a.echeance, COALESCE(a.date_effet, a.echeance)) - 21)::timestamp
                      + interval '9 hours') AT TIME ZONE 'UTC'
            END))
      WHERE a.cabinet_id = $1 AND a.mission_id = $2`,
    p,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_revue_decisions d
        SET cloturee_le = CASE WHEN d.cloturee_le IS NULL THEN NULL
              ELSE LEAST($3::timestamptz, GREATEST(d.cree_le + interval '1 hour',
                     (COALESCE((SELECT max(a.date_effet) FROM kpi_actions a
                                 WHERE a.cabinet_id = $1 AND a.decision_id = d.id), d.echeance)::timestamp
                        + interval '15 hours') AT TIME ZONE 'UTC')) END
       FROM kpi_revues r
      WHERE d.cabinet_id = $1 AND r.cabinet_id = $1 AND r.id = d.revue_id AND r.mission_id = $2`,
    pp,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_revue_decisions d SET modifie_le = COALESCE(d.cloturee_le, d.cree_le)
       FROM kpi_revues r
      WHERE d.cabinet_id = $1 AND r.cabinet_id = $1 AND r.id = d.revue_id AND r.mission_id = $2`,
    c2,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_actions a
        SET modifie_le = LEAST($3::timestamptz, GREATEST(a.cree_le + interval '1 hour',
              (COALESCE(a.date_effet, a.echeance)::timestamp + interval '12 hours') AT TIME ZONE 'UTC'))
      WHERE a.cabinet_id = $1 AND a.mission_id = $2`,
    pp,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_revues r
        SET cloturee_le = CASE WHEN r.cloturee_le IS NULL THEN NULL
              ELSE LEAST($3::timestamptz, GREATEST(r.tenue_le + interval '2 hours',
                     COALESCE((SELECT max(dc.cloturee_le) FROM kpi_revue_decisions dc
                                WHERE dc.cabinet_id = $1 AND dc.revue_id = r.id), r.tenue_le)
                       + interval '18 hours')) END
      WHERE r.cabinet_id = $1 AND r.mission_id = $2`,
    pp,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_revues
        SET modifie_le = COALESCE(cloturee_le, tenue_le, cree_le),
            dossier = CASE WHEN dossier ? 'genere_le' AND tenue_le IS NOT NULL
              THEN jsonb_set(dossier, '{genere_le}',
                             to_jsonb(to_char(tenue_le AT TIME ZONE 'UTC', 'YYYY-MM-DD')))
              ELSE dossier END
      WHERE cabinet_id = $1 AND mission_id = $2`,
    c2,
  );

  // Événements : répartis entre la création et la fin de la décision ou de l'action.
  await appliquerSql(
    ctx,
    `UPDATE kpi_revue_decision_evenements e
        SET cree_le = x.t
       FROM (SELECT e2.id,
                    dc.cree_le + (COALESCE(dc.cloturee_le, dc.cree_le) - dc.cree_le)
                      * ((row_number() OVER (PARTITION BY e2.decision_id ORDER BY e2.cree_le, e2.id)) - 1)::float8
                      / GREATEST((count(*) OVER (PARTITION BY e2.decision_id)) - 1, 1) AS t
               FROM kpi_revue_decision_evenements e2
               JOIN kpi_revue_decisions dc ON dc.id = e2.decision_id AND dc.cabinet_id = e2.cabinet_id
               JOIN kpi_revues r ON r.id = dc.revue_id AND r.cabinet_id = dc.cabinet_id
              WHERE e2.cabinet_id = $1 AND r.mission_id = $2) x
      WHERE e.id = x.id AND e.cabinet_id = $1`,
    c2,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_action_evenements e
        SET cree_le = x.t
       FROM (SELECT e2.id,
                    a.cree_le + (a.modifie_le - a.cree_le)
                      * ((row_number() OVER (PARTITION BY e2.action_id ORDER BY e2.cree_le, e2.id)) - 1)::float8
                      / GREATEST((count(*) OVER (PARTITION BY e2.action_id)) - 1, 1) AS t
               FROM kpi_action_evenements e2
               JOIN kpi_actions a ON a.id = e2.action_id AND a.cabinet_id = e2.cabinet_id
              WHERE e2.cabinet_id = $1 AND a.mission_id = $2) x
      WHERE e.id = x.id AND e.cabinet_id = $1`,
    c2,
  );
}
