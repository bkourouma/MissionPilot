import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Contexte de base du portail client (SOC-09, constat d'audit « RLS du
 * portail indépendante de la liste blanche »).
 *
 * Pour toute requête d'une session du portail (rôles client), la garde
 * (portail/garde.ts) range ici le client rattaché et l'utilisateur ; le pool
 * (db/pool.ts) pose alors `app.portail_client_id` et
 * `app.portail_utilisateur_id` au début de CHAQUE transaction ouverte pendant
 * la requête (withTenant comme withoutTenant). Les politiques restrictives
 * des migrations 0113 et 0114 s'appliquent donc à tout accès à la base, même
 * à un `withTenant` brut écrit hors de `avecPortail`.
 *
 * - Utilisateur du portail sans rattachement actif (rattachement désactivé,
 *   client archivé) : client SENTINELLE, qui ne correspond à aucun client
 *   (échec sûr : rien de l'entreprise n'est visible).
 * - Le contexte n'existe QUE pour les sessions du portail : les requêtes
 *   internes, les tâches de fond et les tests directs sur la base n'en ont pas.
 * - `horsContextePortail` est l'UNIQUE sortie, réservée aux traitements
 *   internes déclenchés par une action du portail et qui ne renvoient rien au
 *   client (par exemple l'évaluation des alertes KPI après une saisie). Son
 *   usage est inventorié par test (portail-contexte.test.ts).
 */

export interface ContexteBasePortail {
  /** Client rattaché, ou SENTINELLE_CLIENT_PORTAIL. */
  clientId: string;
  utilisateurId: string;
}

/** Identifiant qui ne désigne aucun client (gen_random_uuid ne produit jamais l'UUID nul). */
export const SENTINELLE_CLIENT_PORTAIL = "00000000-0000-0000-0000-000000000000";

const stockage = new AsyncLocalStorage<ContexteBasePortail | null>();

/** Contexte du portail de l'exécution courante, ou null (requête interne, tâche de fond). */
export function contexteBasePortail(): ContexteBasePortail | null {
  return stockage.getStore() ?? null;
}

/** Exécute `fn` (et tout ce qu'elle déclenche) dans le contexte du portail. */
export function dansContextePortail<T>(contexte: ContexteBasePortail, fn: () => T): T {
  return stockage.run({ ...contexte }, fn);
}

/**
 * Exécute un traitement INTERNE hors du contexte du portail. Réservé aux
 * suites d'une action du portail qui ne renvoient aucune donnée au client.
 */
export function horsContextePortail<T>(fn: () => Promise<T>): Promise<T> {
  return stockage.run(null, fn);
}
