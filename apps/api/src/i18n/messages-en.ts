/**
 * Version anglaise des messages d'erreur de l'API, indexée par le message français EXACT (tel
 * qu'écrit dans `AppError`, `requeteInvalide`, `conflit`…). Un message absent reste en français.
 * Un message modifié dans le code doit l'être ici aussi (test `i18n-messages.test.ts`).
 */
export const MESSAGES_EN: Readonly<Record<string, string>> = {
  // Socle (errors.ts, app.ts)
  "Connexion requise.": "Sign-in required.",
  "Vous n'avez pas le droit d'effectuer cette action.":
    "You are not allowed to perform this action.",
  "Données invalides.": "Invalid data.",
  "Requête invalide.": "Invalid request.",
  "Erreur interne.": "Internal error.",
  "La double authentification est obligatoire pour votre rôle : configurez-la pour continuer.":
    "Two-factor authentication is required for your role: set it up to continue.",
  // Fragments des motifs (sujets de « … introuvable. »)
  Ressource: "Resource",
  Mission: "Engagement",
  Client: "Client",
  Facture: "Invoice",
};

/**
 * Messages à partie variable : motif sur le message français, rendu anglais à partir des groupes
 * capturés (chaque groupe est lui-même traduit s'il figure dans `MESSAGES_EN`).
 */
export const MOTIFS_EN: ReadonlyArray<readonly [RegExp, (...groupes: string[]) => string]> = [
  [/^(.+) introuvable\.$/, (quoi) => `${quoi} not found.`],
  [/^(.+) introuvable\b/, (quoi) => `${quoi} not found.`],
];
