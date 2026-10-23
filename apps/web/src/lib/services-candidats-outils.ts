/** Services candidats : utilitaires internes partagés entre sous-modules (non ré-exportés). */
import { DEVISES, type Devise } from "./format";
import { lireNombre } from "./saisie";

export const NBSP = String.fromCharCode(0xa0);

export const estDevise = (v: string): v is Devise => (DEVISES as readonly string[]).includes(v);

/** Montant entier en unités de la devise ; `null` si vide, `NaN` si illisible. */
export function lireEntier(v: string): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (!Number.isSafeInteger(n) || n < 0) return Number.NaN;
  return n;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
