import { appelerApi, ErreurApi, messageErreur } from "./api";
import { appelerApiServeur, cookieSession, urlApi, type Chargement } from "./api-serveur";
import {
  cheminSourceCitee,
  cheminSourcesLivrable,
  type LivrableCitation,
  type SourcesLivrableVue,
} from "./citations";
import type { DetailPreuve } from "./preuves";

/**
 * Sources d'un livrable, SANS redirection : une section de citations ne doit jamais emporter la
 * page du livrable qui l'héberge (403, 404 ou panne de l'API : on n'affiche rien). Le contrôle
 * de droits reste celui de l'API.
 */
export async function chargerSourcesLivrable(
  missionId: string,
  livrable: LivrableCitation,
): Promise<SourcesLivrableVue | null> {
  const cookie = await cookieSession();
  if (!cookie) return null;
  try {
    return await appelerApi<SourcesLivrableVue>(cheminSourcesLivrable(missionId, livrable), {
      baseUrl: urlApi(),
      cookie,
      redirigerSi401: false,
    });
  } catch (e) {
    if (e instanceof ErreurApi) return null;
    throw e;
  }
}

/**
 * Ouverture d'une preuve citée : 401 → connexion, 403 → /acces-refuse (comme les pages du
 * registre) ; 404 et autres erreurs reviennent à la page, qui les affiche.
 */
export async function chargerSourceCitee(
  missionId: string,
  livrable: LivrableCitation,
  preuveId: string,
): Promise<Chargement<DetailPreuve>> {
  try {
    return {
      ok: true,
      donnees: await appelerApiServeur<DetailPreuve>(
        cheminSourceCitee(missionId, livrable, preuveId),
      ),
    };
  } catch (e) {
    if (e instanceof ErreurApi) return { ok: false, message: messageErreur(e), statut: e.statut };
    throw e;
  }
}
