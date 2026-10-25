import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { acteursMission } from "./ia-aide.js";
import { chargerMissions, type ModuleLot } from "./commun.js";
import { DECISIONS, type PlanDecision } from "./automatisation-evenements.js";
import { chargerInfosMissions, rejouerHistorique } from "./automatisation-moteur.js";
import { assurerEvenements, assurerRegles } from "./automatisation-regles.js";

/*
 * Module « automatisation » (AUT-01 à AUT-06) du seed Tenant démo.
 *
 * - règles du cabinet (standard et libres), versions, périodes d'activation et responsables
 *   (automatisation-regles.ts), événements métier passés (jalons, KPI, questionnaires, clôtures) ;
 * - historique d'exécution rejoué avec les briques pures du moteur (automatisation-moteur.ts) :
 *   exécutions déclenchées ou aux conditions non remplies, actions autorisées ou refusées par la
 *   garde (le directeur n'a pas le droit d'émettre une facture), résultats, tâches et brouillons ;
 * - décisions humaines sur les brouillons : les anciennes sont datées par SQL (journal en ajout
 *   seul), les plus récentes passent par les VRAIES routes (décision du chef de mission, annulation
 *   par le directeur) ; un brouillon reste volontairement « à valider ».
 * Jamais de coupe-circuit semé (il arrêterait les automatisations). Aucun envoi : les notifications
 * et la relance du client ne sont pas rejouées. Idempotent : règles retrouvées par nom, événements
 * par clé, exécutions par (règle, événement), décisions par brouillon.
 */

async function decider(
  ctx: ContexteTenantDemo,
  b: { id: string; action_id: string; cree_le: Date; mission_id: string },
  plan: PlanDecision,
): Promise<void> {
  const c = ctx.proprietaire;
  // Chef et directeur RÉELS de la mission du brouillon (une mission n'est visible que de son
  // équipe) : les clés symboliques « chef.mission » et « directeur.mission » du plan les désignent.
  const acteurs = await acteursMission(ctx, { id: b.mission_id });
  const reel = (cle: CleCompte): CleCompte =>
    cle === "chef.mission" && acteurs
      ? acteurs.chef
      : cle === "directeur.mission" && acteurs
        ? acteurs.directeur
        : cle;
  const auteurId = (symbolique: CleCompte): string => {
    const cle = reel(symbolique);
    const id = ctx.utilisateurs[cle];
    if (!id) throw new Error(`Utilisateur « ${cle} » introuvable.`);
    return id;
  };
  const apres = (h: number) => new Date(b.cree_le.getTime() + h * 3_600_000).toISOString();
  switch (plan.type) {
    case "historique":
      await c.query(
        `INSERT INTO automatisation_brouillon_decisions (cabinet_id, brouillon_id, decision,
           texte_final, motif, auteur_id, cree_le) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.cabinetId,
          b.id,
          plan.decision,
          plan.decision === "modifiee" ? plan.texteFinal : null,
          plan.decision === "rejetee" ? (plan.motif ?? null) : null,
          auteurId(plan.auteur),
          apres(plan.apresHeures),
        ],
      );
      return;
    case "annulation": {
      const t = apres(plan.apresHeures);
      await c.query("BEGIN");
      try {
        await c.query(
          `INSERT INTO automatisation_brouillon_decisions (cabinet_id, brouillon_id, decision, motif,
             auteur_id, cree_le) VALUES ($1, $2, 'annulee', $3, $4, $5)`,
          [ctx.cabinetId, b.id, plan.motif, auteurId(plan.auteur), t],
        );
        await c.query(
          `INSERT INTO automatisation_annulations (cabinet_id, action_id, motif, auteur_id, cree_le)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.cabinetId, b.action_id, plan.motif, auteurId(plan.auteur), t],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
      return;
    }
    case "route_decision":
      attendre(
        200,
        await ctx
          .session(reel(plan.auteur))
          .post(`/api/automatisations/brouillons/${b.id}/decision`, { decision: "validee" }),
        "décision d'un brouillon d'automatisation",
      );
      return;
    case "route_annulation":
      attendre(
        200,
        await ctx
          .session(reel(plan.auteur))
          .post(`/api/automatisations/actions/${b.action_id}/annuler`, { motif: plan.motif }),
        "annulation d'une action d'automatisation",
      );
      return;
  }
}

async function deciderBrouillons(ctx: ContexteTenantDemo): Promise<number> {
  const r = await ctx.proprietaire.query<{
    id: string;
    action_id: string;
    cree_le: Date;
    mission_id: string;
    cle: string;
  }>(
    `SELECT b.id, b.action_id, b.cree_le, b.mission_id, e.cle
       FROM automatisation_brouillons b
       JOIN automatisation_actions ac ON ac.id = b.action_id
       JOIN automatisation_executions x ON x.id = ac.execution_id
       JOIN automatisation_evenements e ON e.id = x.evenement_id
       LEFT JOIN automatisation_brouillon_decisions d ON d.brouillon_id = b.id
      WHERE b.cabinet_id = $1 AND d.id IS NULL
      ORDER BY b.cree_le, b.id`,
    [ctx.cabinetId],
  );
  let n = 0;
  for (const b of r.rows) {
    const plan = DECISIONS[b.cle.slice(b.cle.indexOf(":") + 1)];
    if (!plan) continue;
    await decider(ctx, b, plan);
    n += 1;
  }
  return n;
}

export const semerAutomatisation: ModuleLot = async (ctx) => {
  const missions = await chargerMissions(ctx);
  const presentes = Object.values(missions);
  if (presentes.length === 0) {
    ctx.journal("automatisation : aucune mission du casting, module ignoré.");
    return;
  }
  const regles = await assurerRegles(ctx);
  const evenements = await assurerEvenements(ctx, missions);
  const infos = await chargerInfosMissions(
    ctx,
    presentes.map((m) => m.id),
  );
  const executions = await rejouerHistorique(ctx, regles, evenements, infos);
  const decisions = await deciderBrouillons(ctx);

  // Lecture par les vraies routes : le journal et les brouillons se relisent comme à l'écran.
  const directeur = ctx.session("directeur.mission");
  attendre(200, await directeur.get("/api/automatisations?limite=50"), "liste des automatisations");
  attendre(200, await directeur.get("/api/automatisations/executions?limite=100"), "journal");
  attendre(200, await directeur.get("/api/automatisations/brouillons?limite=100"), "brouillons");

  ctx.journal(
    `automatisation : ${regles.length} règle(s), ${evenements.length} événement(s), ${executions} exécution(s) créée(s) par cet appel, ${decisions} décision(s) de brouillon.`,
  );
};
