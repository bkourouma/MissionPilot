import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appelerApi, ErreurApi } from "./api";
import { cookieSession, urlApi } from "./api-serveur";
import { cheminDeRetour, ENTETE_CHEMIN } from "./connexion";
import {
  issueErreurPortail,
  messageErreurPortail,
  type ChargementPortail,
  type ProfilPortail,
} from "./portail";
import { CHEMIN_SECURITE_PORTAIL } from "./portail-routes";
import { lireSessionCourante, type Session } from "./session";

/**
 * Chargements serveur de l'espace client (Server Components). À ne pas importer dans un
 * composant client (dépend de `next/headers`).
 *
 * Contrairement à `appelerApiServeur` (application du cabinet), un 403 n'envoie pas vers
 * /acces-refuse (page du cabinet) : l'erreur est affichée dans la page du portail. Seuls
 * 401 (connexion) et 403 TFA_A_CONFIGURER (page « Sécurité » du portail) redirigent.
 */

async function urlConnexion(): Promise<string> {
  const chemin = cheminDeRetour((await headers()).get(ENTETE_CHEMIN));
  return chemin === "/" ? "/connexion" : `/connexion?suite=${encodeURIComponent(chemin)}`;
}

/**
 * Session d'un utilisateur du portail ; un utilisateur du cabinet est renvoyé vers son
 * tableau de bord (le portail n'est pas son espace). Mémoïsée par requête.
 */
export const obtenirSessionPortail = cache(async (): Promise<Session> => {
  const session = await lireSessionCourante();
  if (!session.portail) redirect("/");
  return session;
});

/** Appel d'une route du portail : 401 → connexion ; toute autre erreur est rendue. */
async function appelPortail<T>(chemin: string): Promise<ChargementPortail<T>> {
  let erreur: ErreurApi;
  try {
    const donnees = await appelerApi<T>(chemin, {
      baseUrl: urlApi(),
      cookie: await cookieSession(),
      redirigerSi401: false,
    });
    return { ok: true, donnees };
  } catch (e) {
    if (!(e instanceof ErreurApi)) throw e;
    erreur = e;
  }
  // `redirect` lève une exception propre à Next : l'appeler hors du try.
  if (issueErreurPortail(erreur.statut, erreur.code) === "connexion")
    redirect(await urlConnexion());
  return {
    ok: false,
    statut: erreur.statut,
    code: erreur.code,
    message: messageErreurPortail(erreur),
  };
}

/**
 * Chargement d'une page du portail : 401 → connexion, 403 TFA_A_CONFIGURER → « Sécurité »
 * (le cabinet exige la double authentification) ; les autres erreurs s'affichent sur place.
 */
export async function chargerPortail<T>(chemin: string): Promise<ChargementPortail<T>> {
  const r = await appelPortail<T>(chemin);
  if (!r.ok && issueErreurPortail(r.statut, r.code) === "securite") {
    redirect(CHEMIN_SECURITE_PORTAIL);
  }
  return r;
}

/**
 * Profil, entreprise et partages (`GET /api/portail/moi`), mémoïsé par requête (cadre et
 * accueil). Ne redirige pas sur TFA_A_CONFIGURER : le cadre s'affiche aussi sur la page
 * « Sécurité », où l'on active justement la double authentification.
 */
export const chargerProfilPortail = cache((): Promise<ChargementPortail<ProfilPortail>> =>
  appelPortail<ProfilPortail>("/api/portail/moi"),
);
