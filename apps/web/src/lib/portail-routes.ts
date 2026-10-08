/**
 * Chemins de l'espace client (portail, SOC-09) : constantes et règles d'orientation, sans
 * dépendance (importées par le middleware, qui tourne sur le moteur « edge »). Testées dans
 * `portail-routes.test.ts`.
 *
 * Deux espaces étanches côté web (l'API fait foi, par sa liste blanche) : un utilisateur du
 * portail ne reste jamais dans l'application du cabinet, un utilisateur du cabinet jamais
 * dans le portail.
 */

/** Accueil de l'espace client. */
export const CHEMIN_PORTAIL = "/portail";

/** Configuration de sa double authentification depuis le portail. */
export const CHEMIN_SECURITE_PORTAIL = "/portail/securite";

/** Acceptation d'une invitation du portail (jeton dans le fragment `#jeton=…`). */
export const CHEMIN_INVITATION_PORTAIL = "/portail/invitation";

/** Pages du portail accessibles sans session (chemins exacts, jamais un préfixe). */
export const PAGES_PUBLIQUES_PORTAIL: readonly string[] = [CHEMIN_INVITATION_PORTAIL];

/** Le chemin (éventuellement suivi d'une requête ou d'un fragment) est-il dans le portail ? */
export function estCheminPortail(chemin: string): boolean {
  if (!chemin.startsWith(CHEMIN_PORTAIL)) return false;
  const suite = chemin.charAt(CHEMIN_PORTAIL.length);
  return suite === "" || suite === "/" || suite === "?" || suite === "#";
}

/** Chemin seul (sans requête ni fragment). */
function cheminSeul(chemin: string): string {
  return chemin.split(/[?#]/, 1)[0] ?? chemin;
}

/**
 * Page où conduire un utilisateur après sa connexion (ou s'il est déjà connecté), à partir du
 * chemin de retour DÉJÀ assaini par `cheminDeRetour` :
 * - utilisateur du portail : le chemin demandé s'il est dans le portail (hors invitation),
 *   sinon l'accueil du portail ;
 * - utilisateur du cabinet : le chemin demandé, sauf s'il est dans le portail (tableau de bord).
 */
export function destinationApresConnexion(suite: string, portail: boolean): string {
  const dansPortail = estCheminPortail(suite);
  if (portail) {
    return dansPortail && cheminSeul(suite) !== CHEMIN_INVITATION_PORTAIL ? suite : CHEMIN_PORTAIL;
  }
  return dansPortail ? "/" : suite;
}
