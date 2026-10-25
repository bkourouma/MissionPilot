import type { ContexteTenantDemo } from "../contexte.js";
import { type DefMission } from "./donnees-casting.js";

/*
 * FIN DU SUIVI des KPI d'une mission TERMINÉE, juste avant sa clôture (donc quand toutes les phases,
 * y compris celles qui créent des KPI sur les missions du casting, ont tourné) :
 *
 * 1. par la VRAIE route `PATCH /api/kpi/:id` (chef de la mission), chaque KPI encore actif est
 *    désactivé avec `fin_suivi` = max(fin de mission, dernière mesure) : un KPI actif sans fin de
 *    suivi réclamerait des mesures « en retard » jusqu'à aujourd'hui (alerte calculée à la lecture) ;
 * 2. les instants TECHNIQUES écrits à l'horloge réelle du semis après la clôture (création du KPI,
 *    dernière modification, saisie des mesures, cibles, contributeurs) sont ramenés dans la période
 *    de la mission, par SQL littéral du rôle propriétaire (mode « replica », filtré par cabinet) ;
 *    seules des DATES changent. Une ligne déjà antérieure à la clôture n'est jamais touchée.
 *
 * Rejouable : seuls les KPI actifs sont envoyés ; l'antidatage ne touche que ce qui dépasse la clôture.
 */

interface KpiActif {
  id: string;
  libelle: string;
  debut_suivi: string;
  derniere_mesure: string | null;
}

/** Désactive les KPI actifs de la mission avec leur fin de suivi ; renvoie le nombre traité. */
async function terminerKpi(
  ctx: ContexteTenantDemo,
  def: DefMission,
  missionId: string,
): Promise<number> {
  const kpis = (
    await ctx.proprietaire.query<KpiActif>(
      `SELECT k.id, k.libelle, k.debut_suivi::text AS debut_suivi,
              (SELECT max(m.date_mesure)::text FROM kpi_mesures m
                WHERE m.cabinet_id = $1 AND m.kpi_id = k.id AND NOT m.annulation) AS derniere_mesure
         FROM kpi_definitions k
        WHERE k.cabinet_id = $1 AND k.mission_id = $2 AND k.actif ORDER BY k.cree_le, k.id`,
      [ctx.cabinetId, missionId],
    )
  ).rows;
  for (const k of kpis) {
    const fin = [def.fin, k.derniere_mesure ?? def.fin].reduce((a, b) => (a > b ? a : b));
    const corps = fin >= k.debut_suivi ? { actif: false, fin_suivi: fin } : { actif: false };
    let statut = 0;
    for (const cle of [def.chef, def.directeur, "associe"] as const) {
      const r = await ctx.session(cle).patch(`/api/kpi/${k.id}`, corps);
      statut = r.statusCode;
      if (statut === 200) break;
      if (statut !== 403 && statut !== 404) {
        throw new Error(`Fin de suivi du KPI « ${k.libelle} » : HTTP ${statut} ${r.body}`);
      }
    }
    if (statut !== 200) {
      throw new Error(`Fin de suivi du KPI « ${k.libelle} » : refusée (HTTP ${statut}).`);
    }
  }
  return kpis.length;
}

/** Ramène avant `limite` (clôture) les instants techniques des KPI de la mission qui la dépassent. */
async function antedaterKpi(
  ctx: ContexteTenantDemo,
  def: DefMission,
  missionId: string,
  limite: string,
): Promise<void> {
  const c = ctx.proprietaire;
  const signature = def.signature ?? def.debut;
  const p = [ctx.cabinetId, missionId, limite, signature];
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(
      `UPDATE kpi_definitions
          SET cree_le = (GREATEST(debut_suivi, $4::date)::timestamp + interval '9 hours')
                          AT TIME ZONE 'UTC'
        WHERE cabinet_id = $1 AND mission_id = $2 AND cree_le > $3::timestamptz`,
      p,
    );
    await c.query(
      `UPDATE kpi_definitions
          SET modifie_le = LEAST($3::timestamptz, GREATEST(cree_le,
                ((COALESCE(fin_suivi, debut_suivi) + 1)::timestamp + interval '17 hours')
                  AT TIME ZONE 'UTC'))
        WHERE cabinet_id = $1 AND mission_id = $2 AND modifie_le > $3::timestamptz`,
      p.slice(0, 3),
    );
    await c.query(
      `UPDATE kpi_mesures m
          SET saisie_le = LEAST($3::timestamptz, GREATEST(d.cree_le,
                ((m.date_mesure + 1)::timestamp + interval '9 hours'
                   + (m.numero % 50) * interval '1 minute') AT TIME ZONE 'UTC'))
         FROM kpi_definitions d
        WHERE m.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = m.kpi_id AND d.mission_id = $2
          AND m.saisie_le > $3::timestamptz`,
      p.slice(0, 3),
    );
    await c.query(
      `UPDATE kpi_cibles x
          SET cree_le = LEAST($3::timestamptz, GREATEST(d.cree_le + interval '1 minute',
                (x.a_partir_de::timestamp + interval '8 hours 30 minutes') AT TIME ZONE 'UTC')
                + x.version * interval '1 minute')
         FROM kpi_definitions d
        WHERE x.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = x.kpi_id AND d.mission_id = $2
          AND x.cree_le > $3::timestamptz`,
      p.slice(0, 3),
    );
    await c.query(
      `UPDATE kpi_contributeurs x SET ajoute_le = d.cree_le + interval '2 minutes'
         FROM kpi_definitions d
        WHERE x.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = x.kpi_id AND d.mission_id = $2
          AND x.ajoute_le > $3::timestamptz`,
      p.slice(0, 3),
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/**
 * Termine le suivi des KPI de la mission et ramène leurs instants techniques avant la clôture
 * (`jourCloture`, jour fictif de la clôture) ; renvoie le nombre de KPI désactivés.
 */
export async function finirSuiviKpiMission(
  ctx: ContexteTenantDemo,
  def: DefMission,
  missionId: string,
  jourCloture: string,
): Promise<number> {
  const n = await terminerKpi(ctx, def, missionId);
  await antedaterKpi(ctx, def, missionId, `${jourCloture}T16:00:00Z`);
  return n;
}
