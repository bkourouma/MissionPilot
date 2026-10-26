import type { ContexteTenantDemo } from "../contexte.js";
import { CASTING, trouverMission, type MissionCasting } from "./casting.js";
import { exiger, lire } from "./outils.js";
import { ATELIERS, type PlanAtelier as ClePlan } from "./plans-avances-ateliers-donnees.js";
import { annuaire, jouerAtelier, type PlanAtelier } from "./plans-avances-ateliers.js";
import { jouerMonteCarlo, SIMULATIONS } from "./plans-avances-montecarlo.js";
import { assurerDirigeants, type CleDirigeant } from "./plans-avances-portail.js";
import { jouerPlanVivant } from "./plans-avances-realises.js";
import { PLAN_VIVANT_BAOBAB, PLAN_VIVANT_SICAFE } from "./plans-avances-realises-donnees.js";
import { resoudreActeurs } from "./plans-coeur-acteurs.js";

/*
 * ÉTAPE « plans-avances » de la phase « notation-plans » : ateliers en ligne, Monte-Carlo, réalisés
 * et re-prévisions des plans créés par « plans-coeur » (missions 1, 5 et 6), par les VRAIES routes.
 *
 * CE QUI EXISTE APRÈS L'ÉTAPE
 *  Dirigeants du portail (client_dirigeant, seul rôle admis aux ateliers) : SICAFÉ (Désiré Konan du
 *  socle + Koffi Brou, Awa Coulibaly) et Baobab Assurances (Aminata Sarr + Mamadou Fall, Coumba
 *  Ndiaye), créés par invitation puis acceptation (plans-avances-portail.ts).
 *  Ateliers (plans-avances-ateliers-donnees.ts), cabinet via /plans/…/contribution, dirigeants DEPUIS
 *  LE PORTAIL (/portail/ateliers/…) :
 *   - plan 1 SICAFÉ : priorisation des initiatives (3 méthodes, 3 dirigeants + équipe, un vote révisé,
 *     CLOS, agrégats publiés, synthèse IA retouchée = « modifié ») ; choix des marchés d'export (CLOS,
 *     vote publié, matrice MASQUÉE : 2 contributeurs seulement, sous le seuil de 3 par méthode) ;
 *   - plan 6 Baobab : priorisation des chantiers (CLOS, synthèse IA en brouillon) ; arbitrage de la
 *     première année (OUVERT, 4 contributeurs sur 6 invités) ; cartographie des risques (BROUILLON) ;
 *   - plan 5 Atlantique : leviers de financement (CLOS, atelier interne : 4 membres du cabinet).
 *  Monte-Carlo : 2 simulations plan 1 (v2), 1 plan 5 (v2), 1 plan 6 (v1), graines tirées par l'API ;
 *  un rejeu à l'identique (directeur) sur les plans 1 et 6.
 *  Plan vivant : réalisés SICAFÉ 2025 (T1 à T4, T4 corrigé = 2 versions) et 2026 (T1 à T3), re-prévisions
 *  après chaque trimestre utile (explications IA : 1 « modifié », 1 brouillon), réalisés partiels
 *  Baobab 2026 (T1 à T3) et une re-prévision avec explication en brouillon.
 *  Feuille de route : recalage appliqué seulement sur un plan NON partagé (voir `recalerFeuille`).
 *
 * DÉCISIONS : tables d'ateliers, de simulations, de réalisés et de re-prévisions en ajout seul ou
 * figées à la clôture : `cree_le` est celui de l'exécution (aucun antidatage, aucun contournement).
 * Missions 1 et 5 ouvertes à l'écriture (clôture faite plus tard par la phase « gestion »).
 */

const MISSIONS: Record<ClePlan, MissionCasting> = {
  sicafe: CASTING.sicafe,
  atlantique: CASTING.atlantique,
  baobab: CASTING.baobab,
};

const DIRIGEANTS: Record<ClePlan, readonly CleDirigeant[]> = {
  sicafe: ["sicafe.dg", "sicafe.dga", "sicafe.operations"],
  atlantique: [],
  baobab: ["baobab.dg", "baobab.dga", "baobab.commercial"],
};

async function preparer(ctx: ContexteTenantDemo, cle: ClePlan): Promise<PlanAtelier> {
  const mission = await trouverMission(ctx, MISSIONS[cle]);
  const [plan] = await lire<{ id: string; titre: string }>(
    ctx,
    "SELECT id, titre FROM plans_strategiques WHERE cabinet_id = $1 AND mission_id = $2",
    [ctx.cabinetId, mission.id],
  );
  if (!plan) {
    throw new Error(
      `Plan de « ${mission.intitule} » introuvable : exécuter « plans-coeur » d'abord.`,
    );
  }
  const acteurs = await resoudreActeurs(ctx, mission, true);
  return { id: plan.id, titre: plan.titre, acteurs };
}

/**
 * Applique le recalage de la feuille de route (dépendances fin → début) sur les initiatives à
 * recaler d'un plan. Un plan PARTAGÉ au client n'est pas touché : le recalage crée des versions à
 * revalider et retire le partage, ce qui défairait le travail de « plans-coeur ».
 */
async function recalerFeuille(ctx: ContexteTenantDemo, plan: PlanAtelier): Promise<void> {
  const feuille = await plan.acteurs.chef.get(`/api/plans/${plan.id}/feuille-de-route`);
  exiger(feuille, 200, `feuille de route de « ${plan.titre} »`);
  const arecaler = (feuille.json().initiatives as { id: string; recalee: boolean }[])
    .filter((i) => i.recalee)
    .map((i) => i.id);
  const [p] = await lire<{ partage_client: boolean }>(
    ctx,
    "SELECT partage_client FROM plans_strategiques WHERE id = $1",
    [plan.id],
  );
  if (arecaler.length === 0 || p?.partage_client) {
    ctx.journal(
      `      feuille de route « ${plan.titre} » : ${arecaler.length} initiative(s) à recaler, ${p?.partage_client ? "plan partagé : non appliqué" : "rien à faire"}`,
    );
    return;
  }
  const r = await plan.acteurs.chef.post(`/api/plans/${plan.id}/feuille-de-route/recalage`, {
    initiatives: arecaler,
  });
  exiger(r, 200, `recalage de la feuille de route de « ${plan.titre} »`);
  ctx.journal(
    `      feuille de route « ${plan.titre} » : ${arecaler.length} initiative(s) recalée(s)`,
  );
}

export async function semerPlansAvances(ctx: ContexteTenantDemo): Promise<void> {
  const plans: Record<ClePlan, PlanAtelier> = {
    sicafe: await preparer(ctx, "sicafe"),
    atlantique: await preparer(ctx, "atlantique"),
    baobab: await preparer(ctx, "baobab"),
  };
  const dirigeants = await assurerDirigeants(ctx, [...DIRIGEANTS.sicafe, ...DIRIGEANTS.baobab]);
  for (const spec of ATELIERS) {
    const plan = plans[spec.plan];
    await jouerAtelier(ctx, plan, spec, annuaire(plan.acteurs, dirigeants));
  }
  for (const cle of ["sicafe", "atlantique", "baobab"] as const) {
    await jouerMonteCarlo(ctx, plans[cle], SIMULATIONS[cle]);
  }
  await jouerPlanVivant(ctx, plans.sicafe, PLAN_VIVANT_SICAFE);
  await jouerPlanVivant(ctx, plans.baobab, PLAN_VIVANT_BAOBAB);
  await recalerFeuille(ctx, plans.baobab);
  await recalerFeuille(ctx, plans.sicafe);
}
