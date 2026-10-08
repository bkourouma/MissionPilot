/**
 * Champs de `details` qu'une `AppError` peut transmettre au client (liste
 * blanche, gestionnaire d'`app.ts`) : tout autre champ est ignoré. Chaque champ
 * ne porte que des codes, des rôles, des identifiants déjà connus de l'appelant
 * ou des références de ligne, JAMAIS une donnée sensible (secret, montant
 * interne, verbatim) ; un tableau est tronqué à `DETAILS_MAX_ELEMENTS`.
 * - `violations` : violations de garde du moteur qualité (GARDE_VIOLEE) ;
 * - `erreurs` : lignes refusées d'un import (numéro, code, message) ;
 * - `manquants` : éléments obligatoires manquants (codes ou identifiants).
 */
export const CHAMPS_DETAILS_PUBLICS = ["violations", "erreurs", "manquants"] as const;
export type ChampDetailsPublic = (typeof CHAMPS_DETAILS_PUBLICS)[number];
export const DETAILS_MAX_ELEMENTS = 200;

export class AppError extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
    /** Compléments structurés ; seuls les champs de `CHAMPS_DETAILS_PUBLICS` sont transmis. */
    readonly details?: Partial<Record<ChampDetailsPublic, unknown>>,
  ) {
    super(message);
  }
}

/** `details` d'une AppError réduit à la liste blanche ; undefined s'il ne reste rien. */
export function detailsPublics(
  details: Partial<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const sortie: Record<string, unknown> = {};
  for (const champ of CHAMPS_DETAILS_PUBLICS) {
    if (!Object.prototype.hasOwnProperty.call(details, champ)) continue;
    const valeur = details[champ];
    if (valeur === undefined) continue;
    sortie[champ] = Array.isArray(valeur) ? valeur.slice(0, DETAILS_MAX_ELEMENTS) : valeur;
  }
  return Object.keys(sortie).length > 0 ? sortie : undefined;
}

export const nonAuthentifie = () => new AppError(401, "NON_AUTHENTIFIE", "Connexion requise.");
export const interdit = () =>
  new AppError(403, "INTERDIT", "Vous n'avez pas le droit d'effectuer cette action.");
export const introuvable = (quoi = "Ressource") =>
  new AppError(404, "INTROUVABLE", `${quoi} introuvable.`);
export const requeteInvalide = (message: string) => new AppError(400, "REQUETE_INVALIDE", message);
export const conflit = (message: string) => new AppError(409, "CONFLIT", message);
