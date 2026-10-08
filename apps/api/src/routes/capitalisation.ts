import type { FastifyPluginAsync } from "fastify";

/**
 * CAP : retour d'expérience, temps réels, capitalisation à la clôture (PRD complémentaire).
 *
 * Posé VIDE avant la vague 3 et déjà enregistré sous /api par `app.ts` : le lot concerné le
 * remplit sans toucher `app.ts`. Chaque route appelle `exiger(request, …)` ; aucune n'est
 * ouverte au portail client sans entrée explicite de `LISTE_BLANCHE_PORTAIL`.
 */
export const routesCapitalisation: FastifyPluginAsync = async () => {
  // Routes du lot à venir.
};
