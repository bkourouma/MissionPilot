import { conflit, requeteInvalide } from "../errors.js";

/** Code SQLSTATE d'une erreur PostgreSQL, s'il y en a un. */
function codePg(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function contraintePg(error: unknown): string {
  return typeof error === "object" && error !== null && "constraint" in error
    ? String((error as { constraint: unknown }).constraint ?? "")
    : "";
}

/**
 * Traduit les violations d'unicité (409) et de référence (400) en erreurs
 * métier. `uniques` associe un nom de contrainte (ou "*") à un message.
 */
export async function traduireErreursPg<T>(
  action: Promise<T>,
  uniques: Record<string, string>,
  referenceInconnue = "Référence inconnue.",
): Promise<T> {
  try {
    return await action;
  } catch (error) {
    const code = codePg(error);
    if (code === "23505") {
      const message = uniques[contraintePg(error)] ?? uniques["*"];
      if (message) throw conflit(message);
    }
    if (code === "23503") throw requeteInvalide(referenceInconnue);
    throw error;
  }
}

const COLONNE = /^[a-z_]+$/;

/**
 * Construit « col1 = $n, col2 = $n+1 » à partir d'un objet déjà validé par Zod
 * (schéma strict : les clés sont connues). Les colonnes jsonb sont sérialisées.
 */
export function clauseSet(
  modif: Record<string, unknown>,
  premierIndice: number,
  jsonb: readonly string[] = [],
): { sql: string; valeurs: unknown[] } {
  const morceaux: string[] = [];
  const valeurs: unknown[] = [];
  for (const [colonne, valeur] of Object.entries(modif)) {
    if (valeur === undefined) continue;
    if (!COLONNE.test(colonne)) throw new Error(`Colonne refusée : ${colonne}`);
    valeurs.push(jsonb.includes(colonne) ? JSON.stringify(valeur) : valeur);
    morceaux.push(`${colonne} = $${premierIndice + valeurs.length - 1}`);
  }
  return { sql: morceaux.join(", "), valeurs };
}

/** Montant bigint (renvoyé en chaîne par pg) → nombre, ou null. */
export function montant(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Ne garde que les clés listées (avant/après utiles pour l'audit). */
export function choisir<T extends Record<string, unknown>>(
  objet: T,
  cles: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(cles.filter((c) => c in objet).map((c) => [c, objet[c]]));
}
