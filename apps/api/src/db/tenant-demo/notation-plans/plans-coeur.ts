import type { ContexteTenantDemo } from "../contexte.js";
import { trouverMission } from "./casting.js";
import { resoudreActeurs } from "./plans-coeur-acteurs.js";
import { PLAN_ATLANTIQUE } from "./plans-coeur-atlantique.js";
import { PLAN_BAOBAB } from "./plans-coeur-baobab.js";
import { PLAN_EXPORT } from "./plans-coeur-export.js";
import {
  designerPorteurs,
  jouerElements,
  lierKpis,
  trouverOuCreerPlan,
  type EtatPlan,
} from "./plans-coeur-moteur.js";
import { PLAN_SICAFE } from "./plans-coeur-sicafe.js";
import {
  jouerArbitrages,
  jouerCascade,
  jouerEvaluations,
  jouerModeles,
  observer,
  partager,
  proposerSeulement,
  verifierBancabilite,
} from "./plans-coeur-suite.js";
import type { ResumePlan, SpecPlan } from "./plans-coeur-types.js";
import {
  rapprocherClient,
  semerGuichets,
  semerObservationsBibliotheque,
} from "./plans-coeur-veille.js";

/*
 * ÉTAPE « plans-coeur » de la phase « notation-plans » : plans stratégiques et modèles financiers
 * (service #3) des missions 1, 5, 6 et 10, par les VRAIES routes de l'API.
 *
 * Mécanique : une spécification de plan par mission (plans-coeur-<client>.ts), un moteur de rejeu
 * (plans-coeur-moteur.ts : plan, éléments, KPI, porteurs ; plans-coeur-suite.ts : cascade,
 * portefeuille, modèle financier, partage), des constructeurs (plans-coeur-outils.ts) et des
 * hypothèses de modèles (plans-coeur-modeles.ts). Les chiffres (états financiers, scénarios, VAN,
 * scores, optimisation, bancabilité) sortent des moteurs ; seules les hypothèses sont saisies.
 * Idempotent : plan retrouvé par (mission, titre), éléments par type/titre, versions par numéro.
 *
 * QUI FAIT QUOI (plans/acces.ts) : le chef de la mission crée le plan, calcule le modèle, désigne
 * les porteurs et tient la cascade ; un consultant rédige les éléments (ajouté à l'équipe de la
 * mission par la route s'il n'en fait pas partie) ; le DIRECTEUR de la mission valide les contenus
 * et les versions du modèle (dispensé de la séparation des tâches) et arbitre le portefeuille ;
 * un associé valide la version 2 du modèle du plan 1 et saisit les guichets et observations.
 *
 * DÉCISIONS : les missions du casting restent OUVERTES (la mission 1 « terminée » porte donc un plan
 * validé et partagé alors que sa mission n'est pas encore clôturée) ; aucun contournement de
 * clôture. Les dates de création sont celles de l'exécution (tables en ajout seul : aucun
 * antidatage). Le lien du diagnostic à une notation publiée (plan_diagnostic_notations) n'est pas
 * fait ici : la route n'accepte qu'une notation PUBLIÉE du MÊME client ; l'étape suivante
 * « notations-complement » publie ces notations (missions 1, 5, 6) puis relie les plans 1, 5 et 6.
 *
 * CE QUI EXISTE APRÈS L'ÉTAPE (pour « plans-avances » : ateliers, Monte-Carlo, réalisés, reprévisions).
 * Retrouver un plan : SELECT id FROM plans_strategiques WHERE cabinet_id = $1 AND titre = $2 ;
 * ses éléments : plan_elements (type) + version courante dans plan_element_versions ; clés
 * d'initiative des spécifications : I1 à I11 (plan 1), J1 à J6 (plan 5), K1 à K6 (plan 6).
 *
 *  Mission 1  « Plan stratégique 2025-2028 — SICAFE » ; plan « Plan stratégique 2025-2028 — SICAFE »,
 *             horizon 4 (2025-2028), XOF. COMPLET, TOUT VALIDÉ (26 éléments : diagnostic, SWOT,
 *             vision, 4 axes, 8 objectifs, 11 initiatives dont 5 de la bibliothèque), PARTAGÉ au
 *             portail client (toute écriture de contenu ou de modèle le retire). Modèle : v1
 *             (directeur) et v2 (associé) validées, v2 = référence. 8 liens objectif-KPI, 13 porteurs,
 *             6 projets et 7 jalons, 6 initiatives évaluées (portefeuille), 2 arbitrages.
 *  Mission 5  « Business plan bancable — Atlantique Retail » ; plan « Business plan bancable
 *             2026-2030 — Atlantique Retail », horizon 5, XOF. 19 éléments tous validés (6 initiatives,
 *             7 objectifs liés à des KPI), NON partagé. Modèle : v1 NON validée (financement tout dette),
 *             v2 validée (directeur) = référence ; bancabilité calculée « favorable » sur la v2.
 *             3 projets et 4 jalons, 5 évaluations, 1 arbitrage. Guichets : 6 (cabinet, fictifs).
 *  Mission 6  « Plan stratégique 2026-2030 — Baobab Assurances » (en cours) ; plan « Plan stratégique
 *             2026-2030 — Baobab Assurances », horizon 5, XOF. BROUILLON : 17 éléments (6 validés, 1
 *             « modifié » = la vision, 10 brouillons). Modèle : v1 validée (directeur), v2 brouillon.
 *             Cascade partielle (2 projets, 1 jalon), 4 évaluations, portefeuille proposé et NON arbitré.
 *  Mission 10 « Plan stratégique — Sicafe Export » (signée) ; plan « Plan stratégique 2027-2029 — Sicafe
 *             Export », horizon 3, XOF. 5 éléments en brouillon (diagnostic, SWOT, 1 axe, 2 objectifs),
 *             aucun modèle ni initiative.
 */

/** Rejoue un plan de bout en bout par les routes, sans doublon. */
export async function semerPlan(ctx: ContexteTenantDemo, spec: SpecPlan): Promise<ResumePlan> {
  const mission = await trouverMission(ctx, spec.mission);
  const besoinConsultant =
    spec.elements.some((e) => (e.auteur ?? "consultant") === "consultant") ||
    !!spec.evaluations?.length;
  const acteurs = await resoudreActeurs(ctx, mission, besoinConsultant);
  const planId = await trouverOuCreerPlan(ctx, acteurs, mission, spec);
  const ids = new Map<string, string>();
  for (const [cle, id] of Object.entries(ctx.utilisateurs)) ids.set(`u:${cle}`, id);
  const etat: EtatPlan = { ctx, acteurs, mission, spec, planId, ids };
  await jouerElements(etat);
  await lierKpis(etat);
  await designerPorteurs(etat);
  await jouerCascade(etat);
  await jouerEvaluations(etat);
  await proposerSeulement(etat);
  await jouerArbitrages(etat);
  await jouerModeles(etat);
  await observer(etat);
  await verifierBancabilite(etat);
  await partager(etat);
  ctx.journal(`    plan prêt : ${spec.titre} (${planId})`);
  return { planId, missionId: mission.id, titre: spec.titre, ids };
}

export async function semerPlansCoeur(ctx: ContexteTenantDemo): Promise<void> {
  // Observations avant les plans : elles alimentent l'efficacité observée de la bibliothèque.
  await semerObservationsBibliotheque(ctx);
  await semerPlan(ctx, PLAN_SICAFE);
  await semerGuichets(ctx);
  const atlantique = await semerPlan(ctx, PLAN_ATLANTIQUE);
  const trouves = await rapprocherClient(ctx, ctx.client("atlantique-retail"), {
    objet: "investissement",
    montant: 3_000_000_000,
    devise: "XOF",
  });
  ctx.journal(
    `    veille de guichets : ${trouves} guichet(s) rapproché(s) pour ${atlantique.titre}`,
  );
  await semerPlan(ctx, PLAN_BAOBAB);
  await semerPlan(ctx, PLAN_EXPORT);
}
