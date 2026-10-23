/* Aide commune aux saisies (non réexportée par appels-offres.ts). */

export const ou = (v: string) => (v.trim() === "" ? null : v.trim());
