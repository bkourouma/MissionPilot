/** Sous-module de `questionnaires-definition.ts` : aide interne partagée (non exportée par le point d'entrée). */

export const tronquer = (t: string, max = 60) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
