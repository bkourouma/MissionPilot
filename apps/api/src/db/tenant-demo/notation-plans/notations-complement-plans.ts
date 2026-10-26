import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import { json } from "./notations-outils.js";
import { exiger, lire } from "./outils.js";

/*
 * Lien du diagnostic d'un plan stratégique vers la notation PUBLIÉE du même client
 * (PUT /api/plans/:id/diagnostic/notation, plan_diagnostic_notations en ajout seul).
 * - le chef de la mission écrit le lien (plan.ecrire) ;
 * - la route retire le partage au client d'un plan partagé (SOC-06 : un changement de contenu ne
 *   survit pas au partage) : si le plan l'était, le DIRECTEUR de la mission le partage de nouveau
 *   par la route de partage (le plan reste entièrement validé, donc « prêt pour le client ») ;
 * - sans plan pour la mission (mission 3 : Brasseries du Wouri), rien à lier.
 * Idempotent : un lien déjà posé (quelle que soit la version) n'est pas remplacé.
 */
export async function lierDiagnostic(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  notationId: string,
  chef: CleCompteCabinet,
  directeur: CleCompteCabinet,
): Promise<void> {
  const plans = await lire<{ id: string; titre: string; partage_client: boolean }>(
    ctx,
    "SELECT id, titre, partage_client FROM plans_strategiques WHERE mission_id = $1 ORDER BY cree_le, id",
    [mission.id],
  );
  const plan = plans[0];
  if (!plan) return;
  const [publiee] = await lire<{ id: string }>(
    ctx,
    `SELECT v.id FROM notation_versions v
       JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
      WHERE v.notation_id = $1 ORDER BY v.numero DESC LIMIT 1`,
    [notationId],
  );
  if (!publiee)
    throw new Error(`Notation ${notationId} non publiée : lien du diagnostic impossible.`);

  const courant = await ctx.session(chef).get(`/api/plans/${plan.id}/diagnostic/notation`);
  exiger(courant, 200, "lecture du lien du diagnostic");
  if (json(courant).lien) {
    ctx.journal(`      diagnostic de « ${plan.titre} » : lien déjà posé`);
  } else {
    const r = await ctx.session(chef).put(`/api/plans/${plan.id}/diagnostic/notation`, {
      notation_version_id: publiee.id,
    });
    exiger(r, 200, `lien du diagnostic de « ${plan.titre} » à la notation`);
    ctx.journal(`      diagnostic de « ${plan.titre} » lié à la notation publiée`);
  }

  // Le partage retiré par la route (plan partagé avant le lien) est rétabli par le directeur.
  if (plan.partage_client) {
    const lu = await ctx.session(directeur).get(`/api/plans/${plan.id}`);
    exiger(lu, 200, "lecture du plan");
    const etat = json<{ partage_client: boolean; pret_pour_client: boolean }>(lu);
    if (!etat.partage_client && etat.pret_pour_client) {
      const p = await ctx.session(directeur).post(`/api/plans/${plan.id}/partage`, {
        partage_client: true,
      });
      exiger(p, 200, "partage du plan au client");
      ctx.journal(`      plan « ${plan.titre} » partagé de nouveau au client`);
    }
  }
}
