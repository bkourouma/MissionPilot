import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";
import { COMPETENCES, DECLARATIONS, PREUVES_REPLI } from "./donnees-cap-competences.js";
import { missionDuCasting, sql, type CleMissionCasting } from "./outils.js";

/*
 * Compétences (CAP-06) : référentiel créé par un associé, déclarations des collaborateurs (les leurs,
 * ou celles que le directeur de mission fait pour un stagiaire), décisions des habilités. Un niveau
 * n'est jamais posé par le calcul. Une déclaration reste en attente, une autre est refusée avec
 * motif puis redéclarée. Déclarations et décisions sont en ajout seul : elles portent la date du jour.
 *
 * Preuves : relevées par la route `competences/actualiser` (temps validé sur une brique rattachée,
 * livrables suivis par la qualité) ; si aucune preuve n'existe pour la mission (les feuilles de temps
 * viennent de la phase « gestion », après celle-ci), des preuves de repli sont posées en SQL
 * propriétaire à partir du temps PLANIFIÉ des tâches rattachées (aucun temps réel inventé).
 */

async function referentiel(ctx: ContexteTenantDemo): Promise<Map<string, string>> {
  const associe = ctx.session("associe");
  for (const c of COMPETENCES) {
    const existe = await sql(ctx, "SELECT 1 FROM competences WHERE cabinet_id = $1 AND code = $2", [
      ctx.cabinetId,
      c.code,
    ]);
    if (existe.length > 0) continue;
    corps(await associe.post("/api/capitalisation/competences", c), [201], `compétence ${c.code}`);
  }
  const lignes = await sql<{ id: string; code: string }>(
    ctx,
    "SELECT id, code FROM competences WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  return new Map(lignes.map((l) => [l.code, l.id]));
}

async function declarations(ctx: ContexteTenantDemo, ids: Map<string, string>): Promise<void> {
  for (const d of DECLARATIONS) {
    const competenceId = ids.get(d.competence);
    if (!competenceId) throw new Error(`Compétence ${d.competence} introuvable.`);
    const collaborateurId = ctx.collaborateur(d.collaborateur);
    const auteur = ctx.session(
      d.declarant ?? (d.collaborateur as Parameters<typeof ctx.session>[0]),
    );
    let ligne = (
      await sql<{ id: string; decidee: boolean }>(
        ctx,
        `SELECT d.id, EXISTS (SELECT 1 FROM competence_decisions x WHERE x.declaration_id = d.id) AS decidee
         FROM competence_declarations d
         WHERE d.collaborateur_id = $1 AND d.competence_id = $2 AND d.niveau = $3 AND d.commentaire = $4`,
        [collaborateurId, competenceId, d.niveau, d.commentaire],
      )
    )[0];
    if (!ligne) {
      const r = corps<{ id: string }>(
        await auteur.post("/api/capitalisation/competences/declarations", {
          ...(d.declarant ? { collaborateur_id: collaborateurId } : {}),
          competence_id: competenceId,
          niveau: d.niveau,
          commentaire: d.commentaire,
        }),
        [201],
        `déclaration ${d.collaborateur}/${d.competence}`,
      );
      ligne = { id: r.id, decidee: false };
    }
    if (d.decision && !ligne.decidee) {
      corps(
        await ctx
          .session(d.decision.par)
          .post(`/api/capitalisation/competences/declarations/${ligne.id}/decision`, {
            decision: d.decision.decision,
            commentaire: d.decision.commentaire,
          }),
        [201],
        `décision ${d.collaborateur}/${d.competence}`,
      );
    }
  }
}

/** Preuves d'usage : route d'actualisation, puis repli sur le temps planifié si la mission n'en a pas. */
async function preuves(ctx: ContexteTenantDemo, ids: Map<string, string>): Promise<void> {
  const associe = ctx.session("associe");
  const missions = new Map<CleMissionCasting, { id: string; fin: string }>();
  for (const p of PREUVES_REPLI) {
    if (missions.has(p.mission)) continue;
    const m = await missionDuCasting(ctx, p.mission);
    corps(
      await associe.post(`/api/capitalisation/missions/${m.id}/competences/actualiser`),
      [200],
      "actualisation des preuves",
    );
    const fin = await sql<{ fin: string }>(
      ctx,
      "SELECT coalesce(date_fin, date_debut)::text AS fin FROM missions WHERE id = $1",
      [m.id],
    );
    missions.set(p.mission, { id: m.id, fin: fin[0]?.fin ?? ctx.aujourdhui });
  }
  for (const p of PREUVES_REPLI) {
    const m = missions.get(p.mission);
    const competence = COMPETENCES.find((c) => c.code === p.competence);
    const competenceId = ids.get(p.competence);
    if (!m || !competence || !competenceId) continue;
    const deja = await sql(
      ctx,
      "SELECT 1 FROM competence_preuves WHERE mission_id = $1 AND competence_id = $2 AND collaborateur_id = $3",
      [m.id, competenceId, ctx.collaborateur(p.collaborateur)],
    );
    if (deja.length > 0) continue;
    const t = await sql<{ jours: number; briques: string[] }>(
      ctx,
      `SELECT coalesce(sum(t.duree_jours_ouvres), 0)::int AS jours, array_agg(DISTINCT b.brique_code) AS briques
       FROM cap_taches_briques b JOIN mission_taches t ON t.id = b.tache_id
       WHERE b.mission_id = $1 AND b.brique_code = ANY($2::text[])`,
      [m.id, competence.briques],
    );
    const ligne = t[0];
    if (!ligne || ligne.jours === 0) continue;
    await ctx.proprietaire.query(
      `INSERT INTO competence_preuves (cabinet_id, collaborateur_id, competence_id, source_type,
         source_id, mission_id, centiemes, date_preuve, detail)
       VALUES ($1, $2, $3, 'temps_brique', $4, $4, $5, $6::date, $7)
       ON CONFLICT (collaborateur_id, competence_id, source_type, source_id) DO NOTHING`,
      [
        ctx.cabinetId,
        ctx.collaborateur(p.collaborateur),
        competenceId,
        m.id,
        ligne.jours * 100,
        m.fin,
        `Temps planifié sur les briques : ${ligne.briques.join(", ")}`.slice(0, 300),
      ],
    );
  }
}

export async function semerCompetences(ctx: ContexteTenantDemo): Promise<void> {
  const ids = await referentiel(ctx);
  await declarations(ctx, ids);
  await preuves(ctx, ids);
}
