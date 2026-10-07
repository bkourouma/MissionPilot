import { appelerApi } from "../../lib/api";
import { urlApi } from "../../lib/api-serveur";
import { CHEMIN_COMPTES_DEMO, lireComptesDemo, type CompteDemo } from "../../lib/connexion-demo";

/**
 * Comptes de démonstration, lus par le SERVEUR web sans cookie (route publique) : le navigateur
 * n'émet aucune requête, il ne reste donc aucune trace quand la fonction est désactivée.
 * `null` (aucun bloc affiché) dès que l'API ne répond pas 200 avec la forme attendue : 404 quand
 * `CONNEXION_RAPIDE_DEMO` n'est pas activée, API injoignable, délai dépassé.
 */
export async function chargerComptesDemo(): Promise<CompteDemo[] | null> {
  try {
    const corps = await appelerApi<unknown>(CHEMIN_COMPTES_DEMO, {
      baseUrl: urlApi(),
      redirigerSi401: false,
      delaiMs: 3_000,
    });
    return lireComptesDemo(corps);
  } catch {
    return null;
  }
}
