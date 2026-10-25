import type { ContexteTenantDemo } from "../contexte.js";
import { etalerSurFenetre, estTerminee, sousFenetre, type SourceInstants } from "./antidatage.js";
import type { MissionTrouvee } from "./casting.js";
import { DIMENSIONS_GRILLE, type DefRegistreNotation } from "./preuves-notation-types.js";

/*
 * Antidatage du registre de preuves des missions TERMINÉES (1, 2, 3 et 5) : tout se place entre
 * 5 % et 40 % de la période de la mission, avant le calcul des notations (placé plus tard par
 * l'étape « notations »). Les missions en cours (6 et 9) ne sont pas antidatées.
 *
 * Seules les lignes de CETTE étape sont touchées : celles dont la dimension est l'une des dix
 * dimensions de la grille (les autres lots du registre utilisent d'autres codes). Requêtes
 * littérales, filtrées par `cabinet_id` ; paramètres : $1 cabinet, $2 mission, $3 codes.
 */

/** Sources d'instants, dans l'ordre d'écriture (départage des égalités de transaction). */
function sources(missionId: string): SourceInstants[] {
  const params = [missionId, [...DIMENSIONS_GRILLE]];
  return [
    {
      select: `SELECT id, cree_le AS t FROM preuve_dimensions
                WHERE cabinet_id = $1 AND mission_id = $2 AND code = ANY ($3::text[])`,
      params,
      update:
        "UPDATE preuve_dimensions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
    {
      select: `SELECT p.id, p.cree_le AS t FROM preuves p
                WHERE p.cabinet_id = $1 AND p.mission_id = $2
                  AND EXISTS (SELECT 1 FROM preuve_versions v
                               WHERE v.preuve_id = p.id AND v.cabinet_id = $1
                                 AND v.version = 1 AND v.dimensions && $3::text[])`,
      params,
      update: "UPDATE preuves SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
    {
      select: `SELECT v.id, v.cree_le AS t FROM preuve_versions v
                 JOIN preuves p ON p.id = v.preuve_id
                WHERE v.cabinet_id = $1 AND p.mission_id = $2 AND v.dimensions && $3::text[]`,
      params,
      update:
        "UPDATE preuve_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
    {
      select: `SELECT a.id, a.cree_le AS t FROM assertions a
                WHERE a.cabinet_id = $1 AND a.mission_id = $2
                  AND EXISTS (SELECT 1 FROM assertion_versions v
                               WHERE v.assertion_id = a.id AND v.cabinet_id = $1
                                 AND v.version = 1 AND v.rattachement_type = 'dimension'
                                 AND v.rattachement_code = ANY ($3::text[]))`,
      params,
      update: "UPDATE assertions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
    {
      select: `SELECT v.id, v.cree_le AS t FROM assertion_versions v
                 JOIN assertions a ON a.id = v.assertion_id
                WHERE v.cabinet_id = $1 AND a.mission_id = $2
                  AND v.rattachement_type = 'dimension' AND v.rattachement_code = ANY ($3::text[])`,
      params,
      update:
        "UPDATE assertion_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
    {
      select: `SELECT l.id, l.cree_le AS t FROM assertion_preuve_liens l
                WHERE l.cabinet_id = $1 AND l.mission_id = $2
                  AND EXISTS (SELECT 1 FROM assertion_versions v
                               WHERE v.assertion_id = l.assertion_id AND v.cabinet_id = $1
                                 AND v.version = 1 AND v.rattachement_type = 'dimension'
                                 AND v.rattachement_code = ANY ($3::text[]))`,
      params,
      update:
        "UPDATE assertion_preuve_liens SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
    },
  ];
}

/**
 * Antidate le registre de la mission si elle est terminée. Aucun arbitrage n'est créé par cette
 * étape (aucune contradiction) : `preuve_arbitrages` n'a donc rien à remonter.
 */
export async function antidaterRegistreNotation(
  ctx: ContexteTenantDemo,
  def: DefRegistreNotation,
  mission: MissionTrouvee,
): Promise<void> {
  if (!estTerminee(def.mission.numero)) return;
  const f = sousFenetre(mission, 0.05, 0.4);
  const n = await etalerSurFenetre(ctx, sources(mission.id), f.debut, f.fin);
  ctx.journal(`    registre de notation antidaté : ${n} lignes entre ${f.debut} et ${f.fin}.`);
}
