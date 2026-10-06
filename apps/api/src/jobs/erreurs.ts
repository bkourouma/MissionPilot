/*
 * Erreur des handlers de jobs, dans un module SANS dépendance : un handler
 * inscrit dans REGISTRE_JOBS (jobs/registre.ts) l'importe d'ici, jamais du
 * registre, pour éviter une importation circulaire (registre → handler →
 * registre) qui laisserait une constante du handler non initialisée au
 * chargement du registre. `jobs/registre.ts` la réexporte pour les appelants
 * existants.
 */

/** Erreur qui ne mérite pas de nouvelle tentative (type inconnu, charge invalide…). */
export class ErreurJobDefinitive extends Error {}
