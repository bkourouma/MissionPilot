export class AppError extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const nonAuthentifie = () => new AppError(401, "NON_AUTHENTIFIE", "Connexion requise.");
export const interdit = () =>
  new AppError(403, "INTERDIT", "Vous n'avez pas le droit d'effectuer cette action.");
export const introuvable = (quoi = "Ressource") =>
  new AppError(404, "INTROUVABLE", `${quoi} introuvable.`);
export const requeteInvalide = (message: string) => new AppError(400, "REQUETE_INVALIDE", message);
export const conflit = (message: string) => new AppError(409, "CONFLIT", message);
