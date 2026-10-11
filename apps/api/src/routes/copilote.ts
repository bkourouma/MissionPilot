import type { FastifyPluginAsync } from "fastify";

/**
 * AGT-08 : copilote conversationnel unique, dans les droits de l'utilisateur.
 *
 * Posé VIDE au début du chantier « lacunes de la vague 2 » et déjà enregistré sous /api par
 * `app.ts` : le lot concerné le remplit sans toucher `app.ts`. Chaque route appelle
 * `exiger(request, …)` ; aucune n'est ouverte au portail client sans entrée explicite de
 * `LISTE_BLANCHE_PORTAIL`.
 */
export const routesCopilote: FastifyPluginAsync = async () => {
  // Routes du lot à venir.
};
