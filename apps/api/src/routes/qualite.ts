import type { FastifyPluginAsync } from "fastify";

/**
 * Qualité et responsabilité professionnelle (QUA-01 à QUA-04, PRD complémentaire §10) :
 * classe de risque des briques et livrables, gardes humaines (`gardesRequises`,
 * `evaluerGarde`), revue guidée, quatre yeux et signature des livrables R3.
 *
 * Posé VIDE par la phase 1 de la vague 1 et déjà enregistré sous /api par `app.ts` : le lot
 * QUA (migrations 0280–0299) le remplit sans toucher `app.ts`. Chaque route appellera
 * `exiger(request, …)` avec `qualite.relire` ou `qualite.signer`
 * (`packages/shared/src/roles.ts`) ; aucune n'est ouverte au portail client
 * (`LISTE_BLANCHE_PORTAIL`, `portail/garde.ts`).
 */
export const routesQualite: FastifyPluginAsync = async () => {
  // Routes du lot QUA à venir.
};
