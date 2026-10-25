import type { LightMyRequestResponse } from "fastify";
import type { ContexteTenantDemo } from "../contexte.js";

/* Petits outils communs aux étapes de la phase « notation-plans ». */

type Reponse = Pick<LightMyRequestResponse, "statusCode" | "body" | "json">;

/** Échoue avec un message clair si le statut HTTP n'est pas l'un des statuts attendus. */
export function exiger(r: Reponse, statuts: number | readonly number[], quoi: string): void {
  const attendus = typeof statuts === "number" ? [statuts] : statuts;
  if (!attendus.includes(r.statusCode)) {
    throw new Error(`${quoi} : HTTP ${r.statusCode} ${r.body}`);
  }
}

/** Lignes d'une requête en lecture avec le rôle propriétaire (contrôles d'idempotence, identifiants). */
export async function lire<T extends Record<string, unknown>>(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await ctx.proprietaire.query<T>(sql, params)).rows;
}

/** Vrai si la requête (SELECT 1 ...) renvoie au moins une ligne : clé naturelle déjà semée. */
export async function existe(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[] = [],
): Promise<boolean> {
  return (await ctx.proprietaire.query(sql, params)).rowCount! > 0;
}
