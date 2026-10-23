/**
 * Registre des preuves d'une mission (PRV-01 à PRV-05) côté cabinet : contrats des réponses de
 * l'API, libellés, chemins, droits d'affichage, messages d'erreur et mise en forme. Logique pure,
 * testée dans `preuves.test.ts`.
 *
 * L'indice de solidité, sa lecture (solide, étayée, fragile), les contradictions, la carte de
 * triangulation et le contrôle des livrables R2 et R3 sont ceux du moteur de l'API
 * (`packages/engines/src/preuves`) : ce module les met en forme et ne les recalcule JAMAIS.
 * Les centièmes et dix-millièmes reçus ne sont divisés que pour être affichés.
 *
 * Sous-modules : `preuves-types`, `preuves-libelles`, `preuves-chemins`, `preuves-droits`,
 * `preuves-format`, `preuves-url`.
 */

export * from "./preuves-types";
export * from "./preuves-libelles";
export * from "./preuves-chemins";
export * from "./preuves-droits";
export * from "./preuves-format";
export * from "./preuves-url";
