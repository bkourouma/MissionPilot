import { analyserDateISO } from "../commun/dates";
import type { ChampsEvenement, PayloadEvenement, TypeChampEvenement, ValeurPayload } from "./types";

/*
 * Contenu d'un événement (AUT-01) : chaque champ est DÉCLARÉ par le catalogue et typé ; un
 * champ inconnu, une valeur d'un autre type ou un champ requis absent rendent le contenu
 * invalide. Les valeurs sont scalaires (aucun objet imbriqué) et les textes bornés.
 */

export const TEXTE_PAYLOAD_MAX = 500;
const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CodeErreurPayload = "PAYLOAD_NON_OBJET" | "CHAMP_INCONNU" | "CHAMP_REQUIS" | "TYPE";

export interface ErreurPayload {
  readonly champ: string | null;
  readonly code: CodeErreurPayload;
}

function valeurConforme(type: TypeChampEvenement, v: unknown): boolean {
  switch (type) {
    case "nombre":
      return typeof v === "number" && Number.isFinite(v);
    case "booleen":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && analyserDateISO(v).valide;
    case "identifiant":
      return typeof v === "string" && IDENTIFIANT.test(v);
    default:
      return typeof v === "string" && v.length <= TEXTE_PAYLOAD_MAX;
  }
}

/** Erreurs du contenu au regard des champs déclarés (vide si conforme). */
export function validerPayloadEvenement(
  payload: unknown,
  champs: ChampsEvenement,
): ErreurPayload[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return [{ champ: null, code: "PAYLOAD_NON_OBJET" }];
  }
  const erreurs: ErreurPayload[] = [];
  const p = payload as Record<string, unknown>;
  for (const nom of Object.keys(p).sort()) {
    if (!Object.prototype.hasOwnProperty.call(champs, nom)) {
      erreurs.push({ champ: nom, code: "CHAMP_INCONNU" });
    }
  }
  for (const nom of Object.keys(champs).sort()) {
    const champ = champs[nom]!;
    const v = Object.prototype.hasOwnProperty.call(p, nom) ? p[nom] : undefined;
    if (v === undefined || v === null) {
      if (champ.requis) erreurs.push({ champ: nom, code: "CHAMP_REQUIS" });
      continue;
    }
    if (!valeurConforme(champ.type, v)) erreurs.push({ champ: nom, code: "TYPE" });
  }
  return erreurs;
}

/** Contenu normalisé : champs déclarés seulement, dans l'ordre des noms, absents → null. */
export function normaliserPayloadEvenement(
  payload: Readonly<Record<string, unknown>>,
  champs: ChampsEvenement,
): PayloadEvenement {
  const sortie: Record<string, ValeurPayload> = {};
  for (const nom of Object.keys(champs).sort()) {
    const v = Object.prototype.hasOwnProperty.call(payload, nom) ? payload[nom] : undefined;
    sortie[nom] = v === undefined ? null : (v as ValeurPayload);
  }
  return sortie;
}
