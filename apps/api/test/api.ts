import type { Role } from "@missionpilot/shared";
import { ajouterUtilisateur, connecter, creerCabinet, type Contexte } from "./helpers.js";

type Methode = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Petit client HTTP de test lié à une session (cookie) ou anonyme. */
export function api(ctx: Contexte, cookie?: string) {
  const appel = (method: Methode, url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return {
    get: (url: string) => appel("GET", url),
    post: (url: string, payload: unknown = {}) => appel("POST", url, payload),
    patch: (url: string, payload: unknown) => appel("PATCH", url, payload),
    put: (url: string, payload: unknown) => appel("PUT", url, payload),
    delete: (url: string) => appel("DELETE", url),
    /** Requête brute (corps binaire, en-têtes propres : multipart) avec la session. */
    brut: (options: {
      method: Methode;
      url: string;
      payload?: Buffer | string;
      headers?: Record<string, string>;
    }) =>
      ctx.app.inject({
        method: options.method,
        url: options.url,
        headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
        ...(options.payload === undefined ? {} : { payload: options.payload }),
      }),
  };
}

export type Api = ReturnType<typeof api>;

export interface CabinetTest {
  cabinetId: string;
  associeId: string;
  associe: Api;
  /** Ouvre une session pour un nouvel utilisateur portant ces rôles. */
  avecRoles(roles: Role[]): Promise<Api & { utilisateurId: string }>;
}

export async function cabinetTest(ctx: Contexte, nom: string): Promise<CabinetTest> {
  const c = await creerCabinet(ctx, nom);
  const associe = api(ctx, await connecter(ctx, c.email));
  return {
    cabinetId: c.cabinetId,
    associeId: c.utilisateurId,
    associe,
    avecRoles: async (roles) => {
      const u = await ajouterUtilisateur(ctx, c.cabinetId, roles);
      return { ...api(ctx, await connecter(ctx, u.email)), utilisateurId: u.utilisateurId };
    },
  };
}
