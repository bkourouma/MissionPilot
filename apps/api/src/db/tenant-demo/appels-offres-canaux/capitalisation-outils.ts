import type { SessionDemo } from "../contexte.js";

/* Petits outils communs des modules de capitalisation du Tenant démo. */

export type Reponse = Awaited<ReturnType<SessionDemo["get"]>>;

/** Corps JSON d'une réponse dont le statut est l'un de `statuts`, sinon erreur claire. */
export function corps<T = Record<string, unknown>>(
  r: Reponse,
  statuts: readonly number[],
  quoi: string,
): T {
  if (!statuts.includes(r.statusCode)) {
    throw new Error(`${quoi} : HTTP ${r.statusCode} ${r.body.slice(0, 400)}`);
  }
  return r.json() as T;
}

/** Date ISO (AAAA-MM-JJ) décalée de `n` jours (calcul pur sur des dates fictives). */
export function decaler(date: string, n: number): string {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
