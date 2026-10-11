import type { FastifyPluginAsync } from "fastify";

/**
 * AUT-07 : brief quotidien par rôle (PRD complémentaire §8.3).
 *
 * Posé VIDE au début du chantier « lacunes de la vague 2 » et déjà enregistré sous /api par
 * `app.ts` : le lot concerné le remplit sans toucher `app.ts`. Chaque route appelle
 * `exiger(request, …)` ; aucune n'est ouverte au portail client sans entrée explicite de
 * `LISTE_BLANCHE_PORTAIL`.
 */
export const routesBrief: FastifyPluginAsync = async () => {
  // Routes du lot à venir.
};
