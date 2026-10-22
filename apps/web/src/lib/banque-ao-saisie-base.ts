/* Aides communes à la lecture des saisies (non réexportées par banque-ao.ts). */

export const MOIS = /^(19[5-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/;
export const EN_COURS = new Set(["", "en cours", "en_cours", "-", "…"]);

export const lignes = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
export const champs = (l: string) => l.split("|").map((c) => c.trim());
