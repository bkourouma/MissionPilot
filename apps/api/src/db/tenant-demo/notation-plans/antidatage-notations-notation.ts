import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre, type SourceInstants } from "./antidatage.js";
import type { PlanMission } from "./antidatage-notations-fenetres.js";
import { SOURCES_QUALITE } from "./antidatage-notations-qualite.js";

/*
 * Antidatage de la notation d'une mission terminée, en UN SEUL étalement pour conserver l'ordre
 * d'écriture réel entre tables : notation, calcul des versions, ajustements, journal (soumission,
 * renvoi, publication), suivi qualité R3 (soumission en revue → signature), confiance, plans
 * d'action, lien à la méthode, puis explications IA des versions. Paramètres : $1 = cabinet,
 * $2 = mission. Les dates métier des ajustements sont recalées sur leur instant de création.
 */

/** Versions de notation de la mission (sous-requête littérale réutilisée). */
const SOURCES_NOTATION: readonly SourceInstants[] = [
  {
    select:
      "SELECT n.id, n.cree_le AS t FROM notations n WHERE n.cabinet_id = $1 AND n.mission_id = $2",
    update: "UPDATE notations SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT v.id, v.calcule_le AS t FROM notation_versions v
               JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
              WHERE v.cabinet_id = $1 AND n.mission_id = $2`,
    update:
      "UPDATE notation_versions SET calcule_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT a.id, a.cree_le AS t FROM notation_ajustements a
               JOIN notation_versions v ON v.id = a.version_id AND v.cabinet_id = a.cabinet_id
               JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
              WHERE a.cabinet_id = $1 AND n.mission_id = $2`,
    update:
      "UPDATE notation_ajustements SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.le AS t FROM notation_evenements x
               JOIN notation_versions v ON v.id = x.version_id AND v.cabinet_id = x.cabinet_id
               JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
              WHERE x.cabinet_id = $1 AND n.mission_id = $2`,
    update: "UPDATE notation_evenements SET le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
];

const SOURCES_ANNEXES: readonly SourceInstants[] = [
  {
    select: `SELECT x.id, x.cree_le AS t FROM notation_confiances x
               JOIN notation_versions v ON v.id = x.version_id AND v.cabinet_id = x.cabinet_id
               JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
              WHERE x.cabinet_id = $1 AND n.mission_id = $2`,
    update:
      "UPDATE notation_confiances SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.cree_le AS t FROM notation_plans_action x
               JOIN notations n ON n.id = x.notation_id AND n.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND n.mission_id = $2`,
    update:
      "UPDATE notation_plans_action SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    // Clé primaire = `version_id` : elle joue le rôle d'identifiant.
    select: `SELECT x.version_id AS id, x.cree_le AS t FROM notation_versions_methode x
               JOIN notation_versions v ON v.id = x.version_id AND v.cabinet_id = x.cabinet_id
               JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
              WHERE x.cabinet_id = $1 AND n.mission_id = $2`,
    update:
      "UPDATE notation_versions_methode SET cree_le = $2::timestamptz WHERE version_id = $1 AND cabinet_id = $3",
  },
  {
    // Explication IA d'une version : demande, générations (écart conservé) comme un seul bloc.
    select: `SELECT d.id, d.cree_le AS t FROM ia_demandes d
              WHERE d.cabinet_id = $1 AND d.entite_type = 'notation_explication'
                AND d.entite_id IN (SELECT v.id FROM notation_versions v
                                      JOIN notations n ON n.id = v.notation_id AND n.cabinet_id = v.cabinet_id
                                     WHERE v.cabinet_id = $1 AND n.mission_id = $2)`,
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
];

export async function antidaterNotation(ctx: ContexteTenantDemo, plan: PlanMission): Promise<void> {
  const params = [plan.mission.id];
  const sources = [...SOURCES_NOTATION, ...SOURCES_QUALITE, ...SOURCES_ANNEXES].map((s) => ({
    ...s,
    params,
  }));
  await etalerSurFenetre(ctx, sources, plan.notation.debut, plan.notation.fin);
  // Date métier d'un ajustement = jour de sa saisie (dans la période de la notation).
  await appliquerSql(
    ctx,
    `UPDATE notation_ajustements a
        SET date_ajustement = (a.cree_le AT TIME ZONE 'UTC')::date
       FROM notation_versions v, notations n
      WHERE a.cabinet_id = $1 AND v.id = a.version_id AND v.cabinet_id = a.cabinet_id
        AND n.id = v.notation_id AND n.cabinet_id = v.cabinet_id AND n.mission_id = $2`,
    [ctx.cabinetId, plan.mission.id],
  );
}
