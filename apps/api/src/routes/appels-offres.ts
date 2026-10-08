import type { FastifyPluginAsync } from "fastify";

/**
 * AO-01 à AO-03 et AO-08 : veille, go/no-go, exigences, rétro-planning (PRD complémentaire).
 *
 * Posé VIDE avant la vague 3 et déjà enregistré sous /api par `app.ts` : le lot concerné le
 * remplit sans toucher `app.ts`. Chaque route appelle `exiger(request, …)` ; aucune n'est
 * ouverte au portail client sans entrée explicite de `LISTE_BLANCHE_PORTAIL`.
 */
export const routesAppelsOffres: FastifyPluginAsync = async () => {
  // Routes du lot à venir.
};
