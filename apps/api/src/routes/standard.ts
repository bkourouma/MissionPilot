import type { FastifyPluginAsync } from "fastify";

/**
 * Référentiel de méthodes (STD-01 à STD-14, PRD complémentaire §4, ADR-004) : méthodes
 * versionnées, étapes, briques, facteurs de contexte, règles de modulation (évaluées par le
 * moteur pur `appliquerModulation` de `@missionpilot/engines`), dérogations, mission figée
 * sur une version.
 *
 * Posé VIDE par la phase 1 de la vague 1 et déjà enregistré sous /api par `app.ts` : le lot
 * STD (migrations 0200–0219) le remplit sans toucher `app.ts`. Chaque route appellera
 * `exiger(request, …)` avec `standard.lire`, `standard.gerer` ou `methode.deroger`
 * (`packages/shared/src/roles.ts`) ; aucune n'est ouverte au portail client
 * (`LISTE_BLANCHE_PORTAIL`, `portail/garde.ts`).
 */
export const routesStandard: FastifyPluginAsync = async () => {
  // Routes du lot STD à venir.
};
