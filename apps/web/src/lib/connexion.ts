/** Logique pure de la connexion (sans React), testée dans `connexion.test.ts`. */

/** Nom du cookie de session posé par l'API (`apps/api/src/auth/session.ts`). */
export const COOKIE_SESSION = "mp_session";

/** En-tête interne posé par le middleware : chemin demandé, pour revenir après connexion. */
export const ENTETE_CHEMIN = "x-mp-chemin";

/** Pages accessibles sans session : connexion et acceptation d'une invitation. */
export const PAGES_PUBLIQUES: readonly string[] = ["/connexion", "/invitation"];

const CHEMIN_DEFAUT = "/";

/**
 * Chemin de retour après connexion, limité à un chemin interne de l'application
 * (pas d'URL absolue, pas de « //hote », pas de barre oblique inverse) : empêche une
 * redirection ouverte via `?suite=`.
 */
export function cheminDeRetour(suite: string | string[] | null | undefined): string {
  const valeur = Array.isArray(suite) ? suite[0] : suite;
  if (!valeur || !valeur.startsWith("/")) return CHEMIN_DEFAUT;
  if (valeur.startsWith("//") || valeur.includes("\\")) return CHEMIN_DEFAUT;
  // Caractères de contrôle (dont tabulation et retour à la ligne) : refusés.
  for (const car of valeur) {
    const code = car.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return CHEMIN_DEFAUT;
  }
  if (valeur === "/connexion" || valeur.startsWith("/connexion?")) return CHEMIN_DEFAUT;
  return valeur;
}

export interface SaisieConnexion {
  email: string;
  motDePasse: string;
}

export type ErreursConnexion = Partial<Record<keyof SaisieConnexion, string>>;

const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validerConnexion(saisie: SaisieConnexion): ErreursConnexion {
  const erreurs: ErreursConnexion = {};
  const email = saisie.email.trim();
  if (email === "") erreurs.email = "Saisissez votre adresse e-mail.";
  else if (!FORMAT_EMAIL.test(email) || email.length > 254)
    erreurs.email = "Adresse e-mail invalide. Exemple : prenom.nom@cabinet.ci";
  if (saisie.motDePasse === "") erreurs.motDePasse = "Saisissez votre mot de passe.";
  else if (saisie.motDePasse.length > 200)
    erreurs.motDePasse = "Le mot de passe ne doit pas dépasser 200 caractères.";
  return erreurs;
}
