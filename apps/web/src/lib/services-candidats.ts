/**
 * Services candidats (diagnostic flash, business plan bancable) et guichets de financement :
 * logique pure, testée dans `services-candidats.test.ts`. Les formes de réponse reprennent celles
 * de `apps/api/src/services-candidats/{services,guichets}.ts` ; l'API reste seule juge.
 *
 * Les montants du prix fixe et des guichets sont des entiers en UNITÉS de la devise (le franc CFA
 * comme l'euro ; pas de centimes), comme dans le moteur de rapprochement.
 *
 * Sous-modules : `services-candidats-types`, `-libelles`, `-mission`, `-guichets` et `-rapprochement`.
 */
export * from "./services-candidats-types";
export * from "./services-candidats-libelles";
export * from "./services-candidats-mission";
export * from "./services-candidats-guichets";
export * from "./services-candidats-rapprochement";
