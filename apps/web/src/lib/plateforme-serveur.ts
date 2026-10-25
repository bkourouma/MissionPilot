import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appelerApi, ErreurApi, messageErreur } from "./api";
import { urlApi } from "./api-serveur";
import {
  lireCabinets,
  lireSuperAdmin,
  lireUtilisateurs,
  MESSAGE_REPONSE_INATTENDUE,
  type CabinetListe,
  type SuperAdmin,
  type UtilisateurPlateforme,
} from "./plateforme";
import { CHEMIN_CONNEXION_PLATEFORME, COOKIE_PLATEFORME } from "./plateforme-routes";

/**
 * Appels d'API plateforme depuis le serveur web : seul le cookie `mp_plateforme` est transmis
 * (jamais `mp_session`). À ne pas importer dans un composant client.
 */

async function cookiePlateforme(): Promise<string | undefined> {
  const jeton = (await cookies()).get(COOKIE_PLATEFORME)?.value;
  return jeton ? `${COOKIE_PLATEFORME}=${jeton}` : undefined;
}

async function appeler<T>(chemin: string): Promise<T> {
  return appelerApi<T>(chemin, {
    baseUrl: urlApi(),
    cookie: await cookiePlateforme(),
    redirigerSi401: false,
    delaiMs: 8_000,
  });
}

/** Session plateforme ouverte, ou `null` (absente, expirée, refusée). Lève si l'API est injoignable. */
export async function sessionPlateformeFacultative(): Promise<SuperAdmin | null> {
  if (!(await cookiePlateforme())) return null;
  try {
    return lireSuperAdmin(await appeler<unknown>("/api/plateforme/moi"));
  } catch (e) {
    if (e instanceof ErreurApi && e.statut >= 400 && e.statut < 500) return null;
    throw e;
  }
}

/** Garde des pages de la console : sans session valide, redirection vers la connexion de la console. */
export async function exigerSessionPlateforme(): Promise<SuperAdmin> {
  const session = await sessionPlateformeFacultative();
  if (!session) redirect(CHEMIN_CONNEXION_PLATEFORME);
  return session;
}

export type ChargementPlateforme<T> =
  { ok: true; donnees: T } | { ok: false; message: string; statut: number };

async function charger<T>(
  chemin: string,
  lire: (corps: unknown) => T | null,
): Promise<ChargementPlateforme<T>> {
  let erreur: ErreurApi;
  try {
    const donnees = lire(await appeler<unknown>(chemin));
    return donnees === null
      ? { ok: false, message: MESSAGE_REPONSE_INATTENDUE, statut: 200 }
      : { ok: true, donnees };
  } catch (e) {
    if (!(e instanceof ErreurApi)) throw e;
    erreur = e;
  }
  // `redirect` lève une exception propre à Next : l'appeler hors du try.
  if (erreur.statut === 401) redirect(CHEMIN_CONNEXION_PLATEFORME);
  return { ok: false, message: messageErreur(erreur), statut: erreur.statut };
}

export const chargerCabinets = (): Promise<ChargementPlateforme<CabinetListe[]>> =>
  charger("/api/plateforme/cabinets", lireCabinets);

export const chargerUtilisateurs = (
  cabinetId: string,
): Promise<ChargementPlateforme<UtilisateurPlateforme[]>> =>
  charger(
    `/api/plateforme/cabinets/${encodeURIComponent(cabinetId)}/utilisateurs`,
    lireUtilisateurs,
  );
