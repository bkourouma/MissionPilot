import type { FastifyPluginAsync } from "fastify";

/**
 * Dossier client vivant (DOS-01 à DOS-07, PRD complémentaire §5) : faits datés et sourcés,
 * ingestion des états financiers contrôlée par moteur, indice de fiabilité, frise, export.
 *
 * Posé VIDE par la phase 1 de la vague 1 et déjà enregistré sous /api par `app.ts` : le lot
 * DOS (migrations 0220–0239) le remplit sans toucher `app.ts`. Chaque route appellera
 * `exiger(request, …)` avec `dossier.lire` ou `dossier.ecrire`
 * (`packages/shared/src/roles.ts`) ; aucune n'est ouverte au portail client
 * (`LISTE_BLANCHE_PORTAIL`, `portail/garde.ts`).
 */
export const routesDossierClient: FastifyPluginAsync = async () => {
  // Routes du lot DOS à venir.
};
