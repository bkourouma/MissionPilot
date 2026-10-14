import { requeteInvalide } from "../errors.js";
import { decoderCurseur } from "../http/outils.js";

/*
 * Pagination par curseur des listes du redressement : tri (date de création, id) décroissant, clé
 * en horodatage ISO à la microseconde (modèle routes/missions.ts, `cleTriCreation`).
 */

export interface PageRed<T> {
  elements: T[];
  suivant: string | null;
}

export const cleTriCreation = (alias: string) =>
  `to_char(${alias}.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const HORODATAGE_CURSEUR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/;

/** Curseur (horodatage ISO µs, id) ; 400 s'il est illisible ou si la date n'existe pas. */
export function decoderCurseurCreation(curseur: string | undefined): [string, string] | null {
  const cle = decoderCurseur(curseur);
  if (!cle) return null;
  const ms = HORODATAGE_CURSEUR.exec(cle[0])?.[1];
  const date = ms ? new Date(`${ms}Z`) : null;
  const valide = date !== null && date.getTime() >= 0 && date.toISOString() === `${ms}Z`;
  if (!valide) throw requeteInvalide("Curseur de pagination invalide.");
  return cle;
}
