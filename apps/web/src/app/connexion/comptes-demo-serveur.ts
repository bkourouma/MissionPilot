import { appelerApi } from "../../lib/api";
import { urlApi } from "../../lib/api-serveur";
import { CHEMIN_DEMO, lireDemo, type Demo } from "../../lib/demo-connexion";

/**
 * Démonstration multi-cabinets, lue par le SERVEUR web sans cookie (route publique) : le
 * navigateur n'émet aucune requête, il ne reste donc aucune trace quand la démo est désactivée.
 * `null` (aucun bloc affiché) dès que l'API ne répond pas 200 avec la forme attendue : 404 quand
 * la démonstration n'est pas activée, API injoignable, délai dépassé.
 */
export async function chargerDemo(): Promise<Demo | null> {
  try {
    const corps = await appelerApi<unknown>(CHEMIN_DEMO, {
      baseUrl: urlApi(),
      redirigerSi401: false,
      delaiMs: 3_000,
    });
    return lireDemo(corps);
  } catch {
    return null;
  }
}
