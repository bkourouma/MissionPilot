import type { FastifyPluginAsync } from "fastify";

/**
 * AUT-08 : check-list de clôture bloquante (PRD complémentaire).
 *
 * Posé VIDE au début de la vague 2 et déjà enregistré sous /api par `app.ts` : le lot concerné
 * le remplit sans toucher `app.ts`. Chaque route appelle `exiger(request, …)` ; aucune n'est
 * ouverte au portail client sans entrée explicite de `LISTE_BLANCHE_PORTAIL`.
 */
export const routesCloture: FastifyPluginAsync = async () => {
  // Routes du lot à venir.
};
