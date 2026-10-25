import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import { acteursMission } from "./kpi-acteurs.js";
import { lire } from "./outils.js";

/*
 * FIN DU SUIVI des KPI d'une mission terminée, par la VRAIE route `PATCH /api/kpi/:id` (droit
 * `kpi.gerer` : le chef de la mission) : `actif: false` ET `fin_suivi` = date de fin de la mission.
 * Les phases suivantes de la chaîne rejouent le suivi quotidien (`suivreKpis`) à la date du jour sur
 * toutes les missions encore ouvertes ; il ne regarde que les KPI ACTIFS, donc plus aucune alerte
 * « mesure en retard » ne peut naître sur ces missions.
 *
 * `fin_suivi` ne peut pas précéder `debut_suivi` (contrainte de la base) : un KPI dont le suivi
 * devait commencer APRÈS la fin de la mission (créé par un plan avec un début de suivi futur) est
 * seulement désactivé. Si la route refuse malgré tout `fin_suivi` (400), la désactivation est
 * renvoyée seule. Rejouable : seuls les KPI encore actifs sont envoyés.
 */

export interface BilanFinSuivi {
  /** KPI désactivés avec une fin de suivi. */
  avecFin: number;
  /** Libellés des KPI désactivés SANS fin de suivi (début de suivi postérieur à la fin de mission). */
  sansFin: string[];
}

export async function finirSuiviMission(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
): Promise<BilanFinSuivi> {
  if (!mission.dateFin) throw new Error(`Mission « ${mission.intitule} » sans date de fin.`);
  const acteurs = await acteursMission(ctx, mission.id);
  const session = ctx.session(acteurs.chef);
  const kpis = await lire<{ id: string; libelle: string; debut_suivi: string }>(
    ctx,
    `SELECT id, libelle, debut_suivi::text AS debut_suivi FROM kpi_definitions
      WHERE cabinet_id = $1 AND mission_id = $2 AND actif ORDER BY cree_le, id`,
    [ctx.cabinetId, mission.id],
  );
  const bilan: BilanFinSuivi = { avecFin: 0, sansFin: [] };
  for (const k of kpis) {
    const finPossible = mission.dateFin >= k.debut_suivi;
    let r = await session.patch(
      `/api/kpi/${k.id}`,
      finPossible ? { actif: false, fin_suivi: mission.dateFin } : { actif: false },
    );
    if (r.statusCode === 400 && finPossible) {
      r = await session.patch(`/api/kpi/${k.id}`, { actif: false });
      if (r.statusCode === 200) bilan.sansFin.push(k.libelle);
    } else if (r.statusCode === 200) {
      if (finPossible) bilan.avecFin += 1;
      else bilan.sansFin.push(k.libelle);
    }
    if (r.statusCode !== 200) {
      throw new Error(`Fin de suivi du KPI « ${k.libelle} » : HTTP ${r.statusCode} ${r.body}`);
    }
  }
  return bilan;
}
