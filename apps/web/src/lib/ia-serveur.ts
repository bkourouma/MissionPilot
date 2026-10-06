import { appelerApi, ErreurApi, messageErreur } from "./api";
import { cookieSession, urlApi } from "./api-serveur";

/**
 * Chargement serveur d'une donnée FACULTATIVE de l'écran IA (coûts : « ia.configurer » ET
 * « finance.lire »). Contrairement à `chargerServeur`, un 403 ne redirige pas vers
 * /acces-refuse : la section concernée est simplement masquée. À ne pas importer dans un
 * composant client (dépend de `next/headers`).
 */
export type ChargementFacultatif<T> =
  { etat: "ok"; donnees: T } | { etat: "refuse" } | { etat: "erreur"; message: string };

export async function chargerFacultatif<T>(chemin: string): Promise<ChargementFacultatif<T>> {
  try {
    const donnees = await appelerApi<T>(chemin, {
      baseUrl: urlApi(),
      cookie: await cookieSession(),
      redirigerSi401: false,
    });
    return { etat: "ok", donnees };
  } catch (e) {
    if (!(e instanceof ErreurApi)) throw e;
    if (e.statut === 403) return { etat: "refuse" };
    return { etat: "erreur", message: messageErreur(e) };
  }
}
