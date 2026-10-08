import { z } from "zod";
import { requeteInvalide } from "../errors.js";

export const paramsId = z.object({ id: z.string().uuid() });

/** Curseur opaque : clé de tri de la dernière ligne servie, en base64url. */
export function encoderCurseur(cle: readonly [string, string]): string {
  return Buffer.from(JSON.stringify(cle), "utf8").toString("base64url");
}

const cleCurseur = z.tuple([z.string().max(400), z.string().uuid()]);

export function decoderCurseur(curseur: string | undefined): [string, string] | null {
  if (!curseur) return null;
  try {
    return cleCurseur.parse(JSON.parse(Buffer.from(curseur, "base64url").toString("utf8")));
  } catch {
    throw requeteInvalide("Curseur de pagination invalide.");
  }
}

/** Motif ILIKE « contient », avec les jokers de l'utilisateur échappés. */
export function motifContient(q: string | undefined): string | null {
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Coupe une page lue avec LIMIT n+1 : renvoie les n éléments et le curseur
 * suivant (null s'il n'y a plus rien). `cle` extrait la clé de tri d'une ligne.
 */
export function paginer<T extends { cle_tri: string; id: string }>(
  lignes: T[],
  limite: number,
): { elements: Omit<T, "cle_tri">[]; curseur_suivant: string | null } {
  const page = lignes.slice(0, limite);
  const derniere = page[page.length - 1];
  const curseur_suivant =
    lignes.length > limite && derniere ? encoderCurseur([derniere.cle_tri, derniere.id]) : null;
  return {
    elements: page.map(({ cle_tri: _cle, ...reste }) => reste),
    curseur_suivant,
  };
}
