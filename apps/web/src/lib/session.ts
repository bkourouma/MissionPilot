import { cache } from "react";
import { redirect } from "next/navigation";
import { aPermission, roleSchema, type Permission, type Role } from "@missionpilot/shared";
import { appelerApi, ErreurApi } from "./api";
import { appelerApiServeur, cookieSession, urlApi } from "./api-serveur";

/** Réponse de `GET /api/auth/moi`. */
export interface Session {
  utilisateur: { id: string; email: string; nom: string; roles: Role[] };
  cabinet_id: string;
}

/** Écarte un rôle inconnu de cette version du web plutôt que de planter le filtrage. */
function nettoyer(session: Session): Session {
  const roles = (session.utilisateur.roles ?? []).filter(
    (r): r is Role => roleSchema.safeParse(r).success,
  );
  return { ...session, utilisateur: { ...session.utilisateur, roles } };
}

/** Session courante ; redirige vers /connexion si absente ou expirée. Mémoïsée par requête. */
export const obtenirSession = cache(async (): Promise<Session> => {
  return nettoyer(await appelerApiServeur<Session>("/api/auth/moi"));
});

/**
 * Session si elle existe, `null` sinon, sans rediriger ni lever si l'API est injoignable
 * (utilisé par /connexion, qui doit s'afficher même sans API).
 */
export async function sessionFacultative(): Promise<Session | null> {
  const cookie = await cookieSession();
  if (!cookie) return null;
  try {
    const s = await appelerApi<Session>("/api/auth/moi", {
      baseUrl: urlApi(),
      cookie,
      redirigerSi401: false,
      delaiMs: 5_000,
    });
    return nettoyer(s);
  } catch (e) {
    if (e instanceof ErreurApi) return null;
    throw e;
  }
}

/** Garde serveur d'une page : redirige vers /acces-refuse si la permission manque. */
export async function exigerPermission(permission: Permission): Promise<Session> {
  const session = await obtenirSession();
  if (!aPermission(session.utilisateur.roles, permission)) redirect("/acces-refuse");
  return session;
}
