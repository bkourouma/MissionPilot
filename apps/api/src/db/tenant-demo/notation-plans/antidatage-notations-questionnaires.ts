import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre, type SourceInstants } from "./antidatage.js";
import type { PlanMission } from "./antidatage-notations-fenetres.js";

/*
 * Antidatage des envois de questionnaires d'une mission terminée : envois (création, envoi,
 * clôture), répondants, réponses (saisie, soumission), relances et notifications associées, dans
 * leur ordre d'écriture réel, puis recalage de la date limite (colonne `date` métier) : après
 * l'envoi, à la date de clôture, donc avant la fin de mission. Le questionnaire de satisfaction
 * (titre « Satisfaction… ») va en fin de mission, les autres en début. Paramètres des requêtes :
 * $1 = cabinet, $2 = mission, $3 = vrai pour le questionnaire de satisfaction.
 */

const SOURCES: readonly SourceInstants[] = [
  {
    select: `SELECT e.id, e.cree_le AS t FROM questionnaire_envois e
              WHERE e.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3`,
    update:
      "UPDATE questionnaire_envois SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT r.id, r.ajoute_le AS t FROM questionnaire_repondants r
               JOIN questionnaire_envois e ON e.id = r.envoi_id AND e.cabinet_id = r.cabinet_id
              WHERE r.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3`,
    update:
      "UPDATE questionnaire_repondants SET ajoute_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT e.id, e.envoye_le AS t FROM questionnaire_envois e
              WHERE e.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND e.envoye_le IS NOT NULL`,
    update:
      "UPDATE questionnaire_envois SET envoye_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT n.id, n.cree_le AS t FROM notifications n
               JOIN questionnaire_envois e ON e.cabinet_id = n.cabinet_id AND n.lien LIKE '%' || e.id::text
              WHERE n.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND n.type = 'questionnaire_a_completer'`,
    update: "UPDATE notifications SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT q.id, q.modifie_le AS t FROM questionnaire_reponses q
               JOIN questionnaire_envois e ON e.id = q.envoi_id AND e.cabinet_id = q.cabinet_id
              WHERE q.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND q.modifie_le IS NOT NULL`,
    update:
      "UPDATE questionnaire_reponses SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT q.id, q.soumise_le AS t FROM questionnaire_reponses q
               JOIN questionnaire_envois e ON e.id = q.envoi_id AND e.cabinet_id = q.cabinet_id
              WHERE q.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND q.soumise_le IS NOT NULL`,
    update:
      "UPDATE questionnaire_reponses SET soumise_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.relance_le AS t FROM questionnaire_relances x
               JOIN questionnaire_envois e ON e.id = x.envoi_id AND e.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3`,
    update:
      "UPDATE questionnaire_relances SET relance_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT n.id, n.cree_le AS t FROM notifications n
               JOIN questionnaire_envois e ON e.cabinet_id = n.cabinet_id AND n.lien LIKE '%' || e.id::text
              WHERE n.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND n.type LIKE 'questionnaire%' AND n.type <> 'questionnaire_a_completer'`,
    update: "UPDATE notifications SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT e.id, e.clos_le AS t FROM questionnaire_envois e
              WHERE e.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3
                AND e.clos_le IS NOT NULL`,
    update:
      "UPDATE questionnaire_envois SET clos_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
];

export async function antidaterQuestionnaires(
  ctx: ContexteTenantDemo,
  plan: PlanMission,
): Promise<void> {
  for (const [satisfaction, fenetre] of [
    [false, plan.tot],
    [true, plan.tard],
  ] as const) {
    const params = [plan.mission.id, satisfaction];
    await etalerSurFenetre(
      ctx,
      SOURCES.map((s) => ({ ...s, params })),
      fenetre.debut,
      fenetre.fin,
    );
  }
  // Date limite (colonne `date`) : jour de clôture de l'envoi, au plus tôt le lendemain de l'envoi.
  await appliquerSql(
    ctx,
    `UPDATE questionnaire_envois
        SET date_limite = GREATEST((clos_le AT TIME ZONE 'UTC')::date,
                                   (envoye_le AT TIME ZONE 'UTC')::date + 1)
      WHERE cabinet_id = $1 AND mission_id = $2
        AND date_limite IS NOT NULL AND envoye_le IS NOT NULL AND clos_le IS NOT NULL`,
    [ctx.cabinetId, plan.mission.id],
  );
}
