import type { FastifyPluginAsync } from "fastify";

/**
 * Registre des preuves (PRV-01 à PRV-06, PRD complémentaire §6) : preuves typées et sourcées,
 * assertions pour et contre, indice de solidité, contradictions, carte de triangulation
 * (moteurs `indiceSolidite`, `carteTriangulation`, `detecterAssertionsSansPreuve`).
 *
 * Posé VIDE par la phase 1 de la vague 1 et déjà enregistré sous /api par `app.ts` : le lot
 * PRV (migrations 0240–0259) le remplit sans toucher `app.ts`. Chaque route appellera
 * `exiger(request, …)` avec `preuve.lire` ou `preuve.ecrire`
 * (`packages/shared/src/roles.ts`) ; aucune n'est ouverte au portail client
 * (`LISTE_BLANCHE_PORTAIL`, `portail/garde.ts`).
 */
export const routesPreuves: FastifyPluginAsync = async () => {
  // Routes du lot PRV à venir.
};
