import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";
import { PLANS_BRIQUES } from "./donnees-cap-taches.js";
import { chefDe, missionDuCasting, sql, type CleMissionCasting } from "./outils.js";

/*
 * Base d'estimation (CAP-02) : tâches des missions rattachées à des briques de méthode.
 *
 * - Si la mission n'a AUCUNE tâche, un découpage minimal est créé par les routes (phases puis
 *   tâches, libellés de `donnees-cap-taches.ts`) ; sinon les tâches existantes sont utilisées.
 * - Si la mission n'a pas de méthode liée, la méthode du référentiel prévue est liée par la route
 *   (`PUT /missions/:id/methode`) ; une méthode déjà liée n'est jamais changée.
 * - Les tâches sans rattachement sont rattachées dans l'ordre aux briques de la méthode effective
 *   (route `PUT /capitalisation/missions/:id/taches/:tache/brique`), idempotent par tâche.
 */

interface TacheLue {
  id: string;
  libelle: string;
}

async function tachesDe(ctx: ContexteTenantDemo, missionId: string): Promise<TacheLue[]> {
  return sql<TacheLue>(
    ctx,
    `SELECT t.id, t.libelle FROM mission_taches t
     LEFT JOIN mission_phases p ON p.id = t.phase_id
     WHERE t.cabinet_id = $1 AND t.mission_id = $2 ORDER BY p.ordre, p.libelle, t.ordre, t.libelle`,
    [ctx.cabinetId, missionId],
  );
}

async function creerDecoupage(
  ctx: ContexteTenantDemo,
  missionId: string,
  cle: CleMissionCasting,
): Promise<void> {
  const plan = PLANS_BRIQUES[cle];
  if (!plan) return;
  const chef = ctx.session(await chefDe(ctx, missionId));
  let ordrePhase = 0;
  for (const phase of plan.phases) {
    ordrePhase += 1;
    const p = corps<{ id: string }>(
      await chef.post(`/api/missions/${missionId}/phases`, {
        libelle: phase.libelle,
        ordre: ordrePhase,
      }),
      [201],
      `phase ${phase.libelle}`,
    );
    let ordre = 0;
    for (const t of phase.taches) {
      ordre += 1;
      corps(
        await chef.post(`/api/missions/${missionId}/taches`, {
          parent_id: p.id,
          libelle: t.libelle,
          ordre,
          duree_jours_ouvres: t.duree,
        }),
        [201],
        `tâche ${t.libelle}`,
      );
    }
  }
}

async function lierMethode(
  ctx: ContexteTenantDemo,
  missionId: string,
  codeMethode: string,
): Promise<void> {
  const deja = await sql(ctx, "SELECT 1 FROM mission_methodes WHERE mission_id = $1 LIMIT 1", [
    missionId,
  ]);
  if (deja.length > 0) return;
  const v = await sql<{ id: string }>(
    ctx,
    `SELECT v.id FROM methode_versions v JOIN methodes m ON m.id = v.methode_id
     WHERE m.code = $1 AND v.statut = 'publiee'
     ORDER BY v.version DESC LIMIT 1`,
    [codeMethode],
  );
  const version = v[0];
  if (!version) return; // méthode absente du référentiel : pas de brique pour cette mission
  corps(
    await ctx.session(await chefDe(ctx, missionId)).put(`/api/missions/${missionId}/methode`, {
      version_id: version.id,
      contexte: {},
    }),
    [200, 201],
    `liaison de la méthode ${codeMethode}`,
  );
}

/** Rattache les tâches d'une mission à ses briques ; rend le nombre de rattachements en base. */
export async function preparerBriques(
  ctx: ContexteTenantDemo,
  cle: CleMissionCasting,
): Promise<number> {
  const plan = PLANS_BRIQUES[cle];
  if (!plan) return 0;
  const mission = await missionDuCasting(ctx, cle);
  if ((await tachesDe(ctx, mission.id)).length === 0) await creerDecoupage(ctx, mission.id, cle);
  await lierMethode(ctx, mission.id, plan.methode);
  const lien = await sql(ctx, "SELECT 1 FROM mission_methodes WHERE mission_id = $1 LIMIT 1", [
    mission.id,
  ]);
  if (lien.length === 0) return 0;
  const chef = ctx.session(await chefDe(ctx, mission.id));
  const briques = plan.phases.flatMap((p) => p.taches.map((t) => t.brique));
  const taches = await tachesDe(ctx, mission.id);
  const rattachees = new Set(
    (
      await sql<{ tache_id: string }>(
        ctx,
        "SELECT tache_id FROM cap_taches_briques WHERE mission_id = $1",
        [mission.id],
      )
    ).map((r) => r.tache_id),
  );
  // Tâches du casting retrouvées par libellé ; sinon (tâches du lot 2a) rattachement dans l'ordre.
  const parLibelle = new Map(
    plan.phases.flatMap((p) => p.taches.map((t) => [t.libelle, t.brique] as const)),
  );
  let rang = 0;
  for (const t of taches) {
    const brique = parLibelle.get(t.libelle) ?? briques[rang];
    rang += 1;
    if (!brique || rattachees.has(t.id)) continue;
    const r = await chef.put(`/api/capitalisation/missions/${mission.id}/taches/${t.id}/brique`, {
      brique_code: brique,
    });
    if (r.statusCode === 400) continue; // brique absente de la méthode déjà liée : on n'insiste pas
    corps(r, [200], `rattachement ${t.libelle}`);
  }
  const n = await sql<{ n: number }>(
    ctx,
    "SELECT count(*)::int AS n FROM cap_taches_briques WHERE mission_id = $1",
    [mission.id],
  );
  return n[0]?.n ?? 0;
}
