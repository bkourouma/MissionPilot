/**
 * Chemins et cookie de la console de plateforme (super admin). Sans dépendance : importé par le
 * middleware (moteur « edge »). Testé dans `plateforme.test.ts`.
 *
 * Deux sessions étanches : `mp_session` (cabinet et portail) et `mp_plateforme` (console). Le
 * cookie ne prouve rien (garde réelle = `GET /api/plateforme/moi` côté serveur) ; il sert de
 * premier filtre, comme `mp_session`.
 */

/** Nom du cookie posé par l'API plateforme (`apps/api/src/plateforme/session.ts`). */
export const COOKIE_PLATEFORME = "mp_plateforme";

/** Accueil de la console (liste des cabinets). */
export const CHEMIN_PLATEFORME = "/plateforme";

/** Connexion du super admin (e-mail et mot de passe), seule page publique de la console. */
export const CHEMIN_CONNEXION_PLATEFORME = "/plateforme/connexion";

/** Le chemin relève-t-il de la console (exactement `/plateforme` ou en dessous) ? */
export function estCheminPlateforme(chemin: string): boolean {
  return chemin === CHEMIN_PLATEFORME || chemin.startsWith(`${CHEMIN_PLATEFORME}/`);
}

/** Page publique de la console : la connexion. */
export function estPagePubliquePlateforme(chemin: string): boolean {
  return chemin === CHEMIN_CONNEXION_PLATEFORME;
}

/** Page d'un cabinet dans la console. */
export function cheminCabinetPlateforme(cabinetId: string): string {
  return `${CHEMIN_PLATEFORME}/cabinets/${encodeURIComponent(cabinetId)}`;
}
