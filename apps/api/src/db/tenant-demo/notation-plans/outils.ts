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

/**
 * Lignes d'une requête en LECTURE, dans une transaction du cabinet (rôle applicatif, RLS) : jamais
 * de ligne d'un autre cabinet (Lagune cohabite dans la base), même si la requête n'a pas de
 * filtre `cabinet_id`. Sert aux contrôles d'idempotence et à la recherche d'identifiants.
 */
export async function lire<T extends Record<string, unknown>>(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return ctx.database.withTenant(
    ctx.cabinetId,
    async (db) => (await db.query(sql, params)).rows as T[],
  );
}

/** Vrai si la requête (SELECT 1 ...) renvoie au moins une ligne : clé naturelle déjà semée. */
export async function existe(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[] = [],
): Promise<boolean> {
  return (await lire(ctx, sql, params)).length > 0;
}
