import type { ContexteTenantDemo } from "../contexte.js";
import { etalerSurFenetre } from "./antidatage.js";
import type { FenetresPlan } from "./antidatage-plans.js";

/*
 * Antidatage du CŒUR d'un plan : contenu (éléments, versions, origines, liens KPI, porteurs),
 * modèle financier (versions et validations), cascade et portefeuille, simulations Monte-Carlo.
 * Requêtes littérales, filtrées par `cabinet_id` ; `$2` = identifiant du plan dans les SELECT.
 * À l'ordre d'écriture réel près, chaque appel répartit ses sources sur la fenêtre de la
 * chronologie (antidatage-plans.ts). L'ordre des sources sert à départager deux instants égaux
 * écrits dans la même transaction (p. ex. un élément et sa première version).
 */

export async function antidaterCoeur(
  ctx: ContexteTenantDemo,
  planId: string,
  f: FenetresPlan,
): Promise<void> {
  // Contenu : éléments → versions → origines → liens objectif-KPI → porteurs.
  await etalerSurFenetre(
    ctx,
    [
      {
        select: "SELECT id, cree_le AS t FROM plan_elements WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_elements SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT v.id, v.cree_le AS t FROM plan_element_versions v
                   JOIN plan_elements e ON e.id = v.element_id AND e.cabinet_id = v.cabinet_id
                  WHERE v.cabinet_id = $1 AND e.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_element_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, cree_le AS t FROM plan_initiatives_origines WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_initiatives_origines SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, cree_le AS t FROM plan_objectif_kpis WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_objectif_kpis SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: "SELECT id, cree_le AS t FROM plan_porteurs WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_porteurs SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.contenu.debut,
    f.contenu.fin,
  );

  // Modèle financier : versions calculées, puis validations (l'ordre entre versions est conservé).
  await etalerSurFenetre(
    ctx,
    [
      {
        select:
          "SELECT id, calcule_le AS t FROM plan_modele_versions WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_modele_versions SET calcule_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT w.id, w.valide_le AS t FROM plan_modele_validations w
                   JOIN plan_modele_versions v ON v.id = w.modele_version_id AND v.cabinet_id = w.cabinet_id
                  WHERE w.cabinet_id = $1 AND v.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_modele_validations SET valide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.modele.debut,
    f.modele.fin,
  );

  // Cascade (nœuds, versions) puis portefeuille (évaluations, arbitrage).
  await etalerSurFenetre(
    ctx,
    [
      {
        select:
          "SELECT id, cree_le AS t FROM plan_cascade_noeuds WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_cascade_noeuds SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select: `SELECT v.id, v.cree_le AS t FROM plan_cascade_versions v
                   JOIN plan_cascade_noeuds n ON n.id = v.noeud_id AND n.cabinet_id = v.cabinet_id
                  WHERE v.cabinet_id = $1 AND n.plan_id = $2`,
        params: [planId],
        update:
          "UPDATE plan_cascade_versions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, cree_le AS t FROM plan_portefeuille_evaluations WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_portefeuille_evaluations SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, decide_le AS t FROM plan_portefeuille_arbitrages WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_portefeuille_arbitrages SET decide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.cascade.debut,
    f.cascade.fin,
  );

  // Simulations Monte-Carlo, puis rejeux à l'identique.
  await etalerSurFenetre(
    ctx,
    [
      {
        select:
          "SELECT id, cree_le AS t FROM plan_simulations_montecarlo WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_simulations_montecarlo SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
      {
        select:
          "SELECT id, cree_le AS t FROM plan_rejeux_montecarlo WHERE cabinet_id = $1 AND plan_id = $2",
        params: [planId],
        update:
          "UPDATE plan_rejeux_montecarlo SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    f.simulations.debut,
    f.simulations.fin,
  );
}
