import type { FastifyPluginAsync } from "fastify";

/**
 * Agents IA (AGT-01 à AGT-05, PRD complémentaire §7, ADR-005) : registre des agents, niveaux
 * d'autonomie par brique et par cabinet (`niveauEffectif`, `evaluerPromotion`,
 * `retrogradationAuto`), évaluations de non-régression, contribution de l'IA
 * (`contributionIa`).
 *
 * Posé VIDE par la phase 1 de la vague 1 et déjà enregistré sous /api par `app.ts` : le lot
 * AGT (migrations 0260–0279) le remplit sans toucher `app.ts`. Chaque route appellera
 * `exiger(request, …)` avec `agent.lire`, `agent.gerer` ou `autonomie.decider`
 * (`packages/shared/src/roles.ts`) ; aucune n'est ouverte au portail client
 * (`LISTE_BLANCHE_PORTAIL`, `portail/garde.ts`).
 */
export const routesAgents: FastifyPluginAsync = async () => {
  // Routes du lot AGT à venir.
};
