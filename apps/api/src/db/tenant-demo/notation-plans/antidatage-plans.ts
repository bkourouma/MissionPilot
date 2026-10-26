import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { etalerSurFenetre, sousFenetre, type Fenetre } from "./antidatage.js";
import { antidaterAteliers } from "./antidatage-plans-ateliers.js";
import { antidaterCoeur } from "./antidatage-plans-coeur.js";
import { antidaterDiagnosticEtPartage, antidaterVivant } from "./antidatage-plans-suite.js";
import { CASTING, trouverMission, type MissionTrouvee } from "./casting.js";

/*
 * Antidatage des plans stratégiques des missions TERMINÉES (1 SICAFE et 5 Atlantique Retail) :
 * les routes les ont créés et validés « maintenant » (jour du semis). Les plans 6 (Baobab, en
 * cours) et 10 (Sicafe Export, signée) ne sont JAMAIS touchés : seules les missions listées dans
 * `MISSIONS_PLANS` le sont.
 *
 * CHRONOLOGIE (fractions de la période de la mission, fenêtres disjointes, ordre d'écriture réel
 * conservé à l'intérieur de chaque fenêtre par `etalerSurFenetre`) :
 *   0,03        création du plan
 *   0,05-0,36   éléments, versions d'éléments, initiatives issues de la bibliothèque, liens
 *               objectif-KPI, porteurs
 *   0,38-0,46   versions du modèle financier et leurs validations
 *   0,48-0,60   ateliers (création, invitations, ouverture, contributions, clôture, synthèse IA)
 *   0,62-0,76   cascade (nœuds, versions), évaluations et arbitrage du portefeuille
 *   0,78-0,86   simulations Monte-Carlo et rejeux
 *   0,88-0,90   lien du diagnostic à la notation publiée
 *   0,92        partage au client (plan 1 seulement : le plan 5 n'est pas partagé)
 *   0,94 → fin + 3 jours : plan vivant (réalisés, re-prévisions et leurs explications IA)
 * Tout reste ≤ fin de mission + 4 jours (la clôture fictive est à fin + 6 jours).
 *
 * Rejouable : les rangs d'écriture ne changent pas, les instants calculés non plus.
 */

/** Missions dont le plan est antidaté (les plans 6 et 10 n'y figurent volontairement pas). */
const MISSIONS_PLANS = [CASTING.sicafe, CASTING.atlantique] as const;

/** Fenêtres de la chronologie d'un plan, calculées depuis les dates de sa mission. */
export interface FenetresPlan {
  mission: MissionTrouvee;
  creation: Fenetre;
  contenu: Fenetre;
  modele: Fenetre;
  ateliers: Fenetre;
  cascade: Fenetre;
  simulations: Fenetre;
  diagnostic: Fenetre;
  partage: Fenetre;
  vivant: Fenetre;
  /** Plafond absolu des instants du plan : fin de mission + 4 jours, 17 h UTC. */
  plafond: string;
}

export function fenetresPlan(m: MissionTrouvee): FenetresPlan {
  if (!m.dateFin) throw new Error(`Mission « ${m.intitule} » sans date de fin.`);
  return {
    mission: m,
    creation: sousFenetre(m, 0.03, 0.03),
    contenu: sousFenetre(m, 0.05, 0.36),
    modele: sousFenetre(m, 0.38, 0.46),
    ateliers: sousFenetre(m, 0.48, 0.6),
    cascade: sousFenetre(m, 0.62, 0.76),
    simulations: sousFenetre(m, 0.78, 0.86),
    diagnostic: sousFenetre(m, 0.88, 0.9),
    partage: sousFenetre(m, 0.92, 0.92),
    vivant: {
      debut: sousFenetre(m, 0.94, 0.94).debut,
      fin: `${ajouterJours(m.dateFin, 3)}T17:00:00Z`,
    },
    plafond: `${ajouterJours(m.dateFin, 4)}T17:00:00Z`,
  };
}

/** Plans (identifiants) d'une mission, dans leur ordre de création. */
async function plansDe(ctx: ContexteTenantDemo, missionId: string): Promise<string[]> {
  const r = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM plans_strategiques WHERE cabinet_id = $1 AND mission_id = $2 ORDER BY cree_le, id",
    [ctx.cabinetId, missionId],
  );
  return r.rows.map((l) => l.id);
}

export async function antidaterPlans(ctx: ContexteTenantDemo): Promise<void> {
  for (const cible of MISSIONS_PLANS) {
    const mission = await trouverMission(ctx, cible);
    const f = fenetresPlan(mission);
    for (const planId of await plansDe(ctx, mission.id)) {
      await etalerSurFenetre(
        ctx,
        [
          {
            select:
              "SELECT id, cree_le AS t FROM plans_strategiques WHERE cabinet_id = $1 AND id = $2",
            params: [planId],
            update:
              "UPDATE plans_strategiques SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
          },
        ],
        f.creation.debut,
        f.creation.fin,
      );
      await antidaterCoeur(ctx, planId, f);
      await antidaterAteliers(ctx, planId, f);
      await antidaterDiagnosticEtPartage(ctx, planId, f);
      await antidaterVivant(ctx, planId, f);
      ctx.journal(
        `    antidatage plan « ${mission.intitule} » : ${f.creation.debut} → ${f.plafond}`,
      );
    }
  }
}
