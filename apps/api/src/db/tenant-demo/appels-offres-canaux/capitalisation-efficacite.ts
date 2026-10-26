import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";
import { RECOMMANDATIONS, type RecommandationDemo } from "./donnees-cap-efficacite.js";
import { chefDe, missionDuCasting, sql } from "./outils.js";

/*
 * Efficacité des recommandations (CAP-03) : pour chaque recommandation du retour d'expérience, un
 * KPI de la mission (créé par la route KPI, libellé retrouvé par mission), ses mesures, puis la
 * décision (mise en oeuvre, abandon ou attente) et, pour les recommandations mises en oeuvre, la
 * mesure d'effet calculée par le MOTEUR (route `mesurer`), jamais écrite à la main. Le KPI est
 * propre à la capitalisation (libellé distinctif par mission) : les KPI d'autres phases ne sont
 * pas réutilisés pour ne pas fausser leurs séries.
 */

async function kpiDe(ctx: ContexteTenantDemo, r: RecommandationDemo, missionId: string) {
  const trouve = await sql<{ id: string }>(
    ctx,
    "SELECT id FROM kpi_definitions WHERE mission_id = $1 AND libelle = $2",
    [missionId, r.kpi.libelle],
  );
  if (trouve[0]) return trouve[0].id;
  const k = corps<{ id: string }>(
    await ctx
      .session(r.auteur === "associe" ? "associe" : await chefDe(ctx, missionId))
      .post(`/api/missions/${missionId}/kpi`, {
        libelle: r.kpi.libelle,
        unite: r.kpi.unite,
        sens: r.kpi.sens,
        nature: "stock",
        frequence: "mensuelle",
        perspective: "finances",
        debut_suivi: r.kpi.debut,
        cible: r.kpi.cible,
      }),
    [201],
    `KPI ${r.kpi.libelle}`,
  );
  return k.id;
}

async function mesures(ctx: ContexteTenantDemo, r: RecommandationDemo, kpiId: string) {
  const chef = ctx.session(await chefDe(ctx, (await missionDuCasting(ctx, r.mission)).id));
  for (const [date, valeur] of r.mesures) {
    const deja = await sql(
      ctx,
      "SELECT 1 FROM kpi_mesures WHERE kpi_id = $1 AND date_mesure = $2::date AND NOT annulation",
      [kpiId, date],
    );
    if (deja.length > 0) continue;
    corps(
      await chef.post(`/api/kpi/${kpiId}/mesures`, { date_mesure: date, valeur }),
      [201],
      `mesure ${r.kpi.libelle} ${date}`,
    );
  }
}

async function traiter(ctx: ContexteTenantDemo, r: RecommandationDemo): Promise<void> {
  const mission = await missionDuCasting(ctx, r.mission);
  const kpiId = await kpiDe(ctx, r, mission.id);
  await mesures(ctx, r, kpiId);
  const auteur = ctx.session(r.auteur === "associe" ? "associe" : await chefDe(ctx, mission.id));
  let rec = (
    await sql<{ id: string; statut: string }>(
      ctx,
      "SELECT id, statut FROM cap_recommandations WHERE mission_id = $1 AND libelle = $2",
      [mission.id, r.libelle],
    )
  )[0];
  if (!rec) {
    const c = corps<{ id: string; statut: string }>(
      await auteur.post("/api/capitalisation/efficacite/recommandations", {
        mission_id: mission.id,
        kpi_id: kpiId,
        libelle: r.libelle,
        type_initiative: r.type,
        valeur_cible: String(r.kpi.cible),
      }),
      [201],
      `recommandation ${r.libelle}`,
    );
    rec = { id: c.id, statut: "recommandee" };
  }
  const base = `/api/capitalisation/efficacite/recommandations/${rec.id}`;
  if (rec.statut === "recommandee" && r.statut === "mise_en_oeuvre") {
    corps(
      await auteur.post(`${base}/mise-en-oeuvre`, { mise_en_oeuvre_le: r.miseEnOeuvre }),
      [200],
      "mise en oeuvre",
    );
  } else if (rec.statut === "recommandee" && r.statut === "abandonnee") {
    corps(await auteur.post(`${base}/abandon`, { motif: r.motifAbandon }), [200], "abandon");
  }
  if (r.statut === "mise_en_oeuvre") {
    const deja = await sql(
      ctx,
      "SELECT 1 FROM cap_efficacite_mesures WHERE recommandation_id = $1",
      [rec.id],
    );
    if (deja.length === 0) corps(await auteur.post(`${base}/mesurer`), [201], "mesure d'effet");
  }
}

export async function semerEfficacite(ctx: ContexteTenantDemo): Promise<void> {
  for (const r of RECOMMANDATIONS) await traiter(ctx, r);
}
