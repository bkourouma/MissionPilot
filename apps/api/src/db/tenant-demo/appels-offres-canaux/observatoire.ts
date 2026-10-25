import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";
import { sql } from "./outils.js";

/*
 * Observatoire inter-cabinets du Tenant démo (CAP-04) : adhésion VOLONTAIRE du cabinet par un
 * associé (consentement explicite exigé par la route), puis versement de ses contributions.
 *
 * Contributions : UNIQUEMENT par la route « verser », qui reprend le score global (calculé par le
 * moteur de notation) de la dernière notation PUBLIÉE de chaque client (secteur normalisé, taille,
 * valeur au dixième : aucun nom ni identifiant). Aucune valeur n'est écrite à la main : si la phase
 * « notation-plans » n'a publié aucune notation, le versement est sauté (journal « observatoire non
 * versé : notation absente ») et `obs_contributions` reste vide, sans échec.
 *
 * Agrégats : l'API ne les sert qu'à un cabinet contributeur ET pour un mois civil clos (les
 * données sont gelées par mois) et au-dessus des seuils inter-cabinets (5 entreprises, 3 cabinets) :
 * avec un seul cabinet, aucune case n'est publiable ; la lecture est tentée et son refus consigné.
 */

interface EtatAdhesion {
  active: boolean;
}

async function adherer(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const etat = corps<EtatAdhesion>(await associe.get("/api/observatoire/adhesion"), [200], "état");
  if (etat.active) return;
  corps(
    await associe.post("/api/observatoire/adhesion", {
      consentement: true,
      motif:
        "Le cabinet souhaite situer ses clients par rapport aux entreprises comparables de la région, sous réserve de l'anonymisation.",
    }),
    [201],
    "adhésion à l'observatoire",
  );
}

async function notationsPubliees(ctx: ContexteTenantDemo): Promise<number> {
  const r = await sql<{ n: number }>(
    ctx,
    `SELECT count(*)::int AS n FROM notation_evenements e
     JOIN notation_versions v ON v.id = e.version_id
     JOIN notations n ON n.id = v.notation_id
     WHERE n.cabinet_id = $1 AND e.action = 'publication'`,
    [ctx.cabinetId],
  );
  return r[0]?.n ?? 0;
}

async function verser(ctx: ContexteTenantDemo): Promise<string> {
  const deja = await sql<{ n: number }>(
    ctx,
    "SELECT count(*)::int AS n FROM obs_contributions WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  if ((deja[0]?.n ?? 0) > 0) return "contributions déjà présentes";
  if ((await notationsPubliees(ctx)) === 0) return "observatoire non versé : notation absente";
  const r = corps<{ versees: number }>(
    await ctx.session("associe").post("/api/observatoire/contributions", {}),
    [201],
    "versement",
  );
  return `versement par la route (${r.versees} contribution(s))`;
}

export async function semerObservatoire(ctx: ContexteTenantDemo): Promise<void> {
  await adherer(ctx);
  const versement = await verser(ctx);
  const resume = corps<{ en_attente: { nombre: number } | null }>(
    await ctx.session("associe").get("/api/observatoire/contributions/resume"),
    [200],
    "résumé des contributions",
  );
  const agregats = await ctx.session("directeur.mission").get("/api/observatoire/agregats");
  ctx.journal(
    `  observatoire : adhésion active, ${versement} ; en attente : ${resume.en_attente?.nombre ?? 0} ; agrégats : HTTP ${agregats.statusCode}.`,
  );
}
