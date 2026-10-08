import { appelerApi, ErreurApi, messageErreur } from "./api";
import { chargerServeur, cookieSession, urlApi, type Chargement } from "./api-serveur";

/**
 * Chargements serveur des écrans KPI qui ne doivent PAS rediriger sur un refus : la liste
 * des comptes du portail d'un client (`portail.gerer`, et le client doit être géré par
 * l'utilisateur) est un complément de la page ; un 403 devient un message sur place au lieu
 * de la page « Accès refusé ». Une session expirée (401) redirige comme ailleurs.
 * À n'importer que côté serveur (dépend de `next/headers`).
 */
export async function chargerSansRedirection<T>(chemin: string): Promise<Chargement<T>> {
  try {
    const donnees = await appelerApi<T>(chemin, {
      baseUrl: urlApi(),
      cookie: await cookieSession(),
      redirigerSi401: false,
    });
    return { ok: true, donnees };
  } catch (e) {
    if (!(e instanceof ErreurApi)) throw e;
    // 401 : `chargerServeur` redirige vers la connexion (hors du try, comme `redirect` l'exige).
    if (e.statut === 401) return chargerServeur<T>(chemin);
    return { ok: false, message: messageErreur(e), statut: e.statut };
  }
}
