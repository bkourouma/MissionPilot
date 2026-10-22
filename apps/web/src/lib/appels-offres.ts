/**
 * Appels d'offres, lot AO-A (AO-01 à AO-03, AO-08) : types des réponses de l'API, libellés,
 * chemins, droits d'affichage, lecture des saisies et de l'import CSV. Logique pure, testée dans
 * `appels-offres.test.ts`.
 *
 * RÈGLE : rapprochement, score go/no-go, synthèse de conformité, rétro-planning et alertes sont
 * CALCULÉS par l'API (moteur packages/engines/src/appels-offres). Ce module n'en recalcule rien :
 * il met en forme ce que l'API renvoie et lit les saisies (conversion de texte en valeur). Les
 * droits ci-dessous sont un confort d'affichage ; l'API reste seule juge.
 *
 * Sous-modules : `appels-offres-types` (réponses de l'API), `appels-offres-libelles` (droits,
 * libellés, tonalités), `appels-offres-chemins` (chemins et erreurs), `appels-offres-saisies`
 * (fiche et import CSV), `appels-offres-evaluations` (évaluation, motif, exigence).
 */

export * from "./appels-offres-types";
export * from "./appels-offres-libelles";
export * from "./appels-offres-chemins";
export * from "./appels-offres-saisies";
export * from "./appels-offres-evaluations";
