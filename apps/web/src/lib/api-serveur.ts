import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appelerApi, ErreurApi, messageErreur, type OptionsAppel } from "./api";
import { cheminDeRetour, COOKIE_SESSION, ENTETE_CHEMIN } from "./connexion";

/**
 * Appels d'API depuis le serveur (Server Components, actions) : appel direct à l'API, en ne
 * transmettant que le cookie de session de la requête entrante. À ne pas importer dans un
 * composant client (dépend de `next/headers`).
 */

/** Origine de l'API vue du serveur web. */
export function urlApi(): string {
  return (process.env.API_URL ?? "http://localhost:4100").replace(/\/+$/, "");
}

export async function cookieSession(): Promise<string | undefined> {
  const jeton = (await cookies()).get(COOKIE_SESSION)?.value;
  return jeton ? `${COOKIE_SESSION}=${jeton}` : undefined;
}

async function urlConnexion(): Promise<string> {
  const chemin = cheminDeRetour((await headers()).get(ENTETE_CHEMIN));
  return chemin === "/" ? "/connexion" : `/connexion?suite=${encodeURIComponent(chemin)}`;
}

/**
 * Comme `appelerApi`, mais : 401 → redirection vers /connexion, 403 → /acces-refuse.
 * Les autres erreurs remontent (error boundary).
 */
export async function appelerApiServeur<T>(
  chemin: string,
  options: Omit<OptionsAppel, "baseUrl" | "cookie" | "redirigerSi401"> = {},
): Promise<T> {
  let erreur: ErreurApi;
  try {
    return await appelerApi<T>(chemin, {
      ...options,
      baseUrl: urlApi(),
      cookie: await cookieSession(),
      redirigerSi401: false,
    });
  } catch (e) {
    if (!(e instanceof ErreurApi)) throw e;
    erreur = e;
  }
  // `redirect` lève une exception propre à Next : l'appeler hors du try.
  if (erreur.statut === 401) redirect(await urlConnexion());
  if (erreur.statut === 403) redirect("/acces-refuse");
  throw erreur;
}

/** Résultat d'un chargement affichable dans la page (état d'erreur local au lieu d'une page d'erreur). */
export type Chargement<T> =
  { ok: true; donnees: T } | { ok: false; message: string; statut: number };

/**
 * Comme `appelerApiServeur`, mais une erreur d'API (réseau, 404, 500…) devient un résultat
 * `{ ok: false }` que la page affiche sur place. 401 et 403 redirigent toujours.
 */
export async function chargerServeur<T>(chemin: string): Promise<Chargement<T>> {
  try {
    return { ok: true, donnees: await appelerApiServeur<T>(chemin) };
  } catch (e) {
    if (e instanceof ErreurApi) return { ok: false, message: messageErreur(e), statut: e.statut };
    throw e;
  }
}
