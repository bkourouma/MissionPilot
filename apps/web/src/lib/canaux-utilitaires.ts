/** Sous-module de `canaux.ts` : aides internes partagées (non exportées par le point d'entrée). */

export function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function un(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
