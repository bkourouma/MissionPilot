import type { ChampsEvenement, PayloadEvenement } from "./types";

/*
 * Gabarits des textes produits par une automatisation (titre d'une tâche, corps d'une note,
 * variables d'un agent) : `{{champ}}` est remplacé par la valeur du champ du contenu de
 * l'événement, rien d'autre. Aucun calcul, aucune expression : un champ absent ou nul
 * devient une chaîne vide. Les nombres sont ceux du contenu, eux-mêmes issus des moteurs.
 */

const VARIABLE = /\{\{\s*([a-z_][a-z0-9_]{0,59})\s*\}\}/g;

/** Noms des champs cités par le gabarit, sans doublon, dans l'ordre d'apparition. */
export function variablesGabarit(gabarit: string): string[] {
  const vus: string[] = [];
  for (const m of gabarit.matchAll(VARIABLE)) {
    const nom = m[1]!;
    if (!vus.includes(nom)) vus.push(nom);
  }
  return vus;
}

/** Champs cités par le gabarit et inconnus de l'événement (vide si tout est connu). */
export function variablesInconnues(gabarit: string, champs: ChampsEvenement): string[] {
  return variablesGabarit(gabarit).filter((v) => !Object.prototype.hasOwnProperty.call(champs, v));
}

/** Texte rendu : chaque `{{champ}}` remplacé par sa valeur (chaîne vide si absente). */
export function rendreGabarit(gabarit: string, payload: PayloadEvenement): string {
  return gabarit.replace(VARIABLE, (_tout, nom: string) => {
    const v = Object.prototype.hasOwnProperty.call(payload, nom) ? payload[nom] : undefined;
    return v === undefined || v === null ? "" : String(v);
  });
}
