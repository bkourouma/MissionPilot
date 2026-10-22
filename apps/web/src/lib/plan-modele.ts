/**
 * Modèle financier d'un plan stratégique (PLA-06, PLA-07, PLA-09) : types des réponses de
 * l'API (résultat figé du moteur `engines/plan-strategique`), lignes des états, libellés,
 * alertes, scénarios, comparaison, ROI et messages. Logique pure, testée dans
 * `plan-modele.test.ts`.
 *
 * RÈGLE : aucun chiffre n'est calculé ici. États financiers, indicateurs, scénarios, alertes,
 * VAN et TRI viennent TELS QUELS de l'API (et de son moteur) ; ce module choisit des champs et
 * les met en forme (montants dans la devise du plan, en unités mineures). Le web n'importe pas
 * `@missionpilot/engines` (CODING_STANDARDS §1) : les types ci-dessous reprennent la forme du
 * résultat sérialisé par l'API.
 *
 * Simplifications du moteur (en-tête de `packages/engines/src/plan-strategique/modele.ts`) :
 * format SYSCOHADA révisé simplifié, amortissement linéaire en année pleine, impôt payé dans
 * l'exercice, pas d'opérations HAO, de cessions ni de provisions, pas de frais de découvert.
 * Les codes de postes SYSCOHADA affichés sont INDICATIFS (à confirmer par un expert-comptable).
 *
 * Sous-modules : `plan-modele-types` (types et constantes), `plan-modele-format` (mise en forme),
 * `plan-modele-lignes-*` et `plan-modele-etats` (lignes des états), `plan-modele-scenarios`
 * (synthèse, scénarios, alertes), `plan-modele-versions`, `plan-modele-comparaison` (comparaison
 * et ROI) et `plan-modele-api` (messages d'erreur, chemins).
 */
export * from "./plan-modele-types";
export * from "./plan-modele-format";
export type { LigneEtat, EtatFinancier } from "./plan-modele-lignes-base";
export { LIGNES_BILAN, LIGNES_COMPTE_RESULTAT } from "./plan-modele-lignes-bilan";
export { LIGNES_FLUX, LIGNES_INDICATEURS } from "./plan-modele-lignes-flux";
export * from "./plan-modele-etats";
export * from "./plan-modele-scenarios";
export * from "./plan-modele-versions";
export * from "./plan-modele-comparaison";
export * from "./plan-modele-api";
