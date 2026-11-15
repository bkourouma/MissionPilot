import { MESSAGES_EXACTS_EN } from "./messages-en-tables.js";
import { MOTIFS_SPECIFIQUES_EN, type MotifEn } from "./messages-en-motifs.js";

/**
 * Version anglaise des messages d'erreur de l'API, indexée par le message français EXACT (tel
 * qu'écrit dans `AppError`, `requeteInvalide`, `conflit`…). Un message absent reste en français.
 * Un message modifié dans le code doit l'être ici aussi (test `i18n-messages.test.ts`).
 * La table des messages complets est dans `messages-en-tables.ts`, celle des messages à partie
 * variable dans `messages-en-motifs.ts` ; les fragments ci-dessous sont les valeurs variables
 * (sujets de « … introuvable. », libellés de plafonds) que les motifs traduisent.
 */
export const MESSAGES_EN: Readonly<Record<string, string>> = {
  ...MESSAGES_EXACTS_EN,
  // Fragments des motifs (sujets de « … introuvable. », libellés de plafonds, rôles)
  Ressource: "Resource",
  Mission: "Engagement",
  Client: "Client",
  Facture: "Invoice",
  Étapes: "Steps",
  Briques: "Building blocks",
  Éléments: "Items",
  Rubriques: "Sections",
  "Règles de modulation": "Modulation rules",
  "Cas types": "Test cases",
  "Directeur de mission": "Engagement director",
  "Chef de mission": "Engagement manager",
  "dimensionnements par dossier": "sizings per file",
  "dossiers de due diligence par mission": "due diligence files per engagement",
  "filtrages par dossier": "filterings per file",
  "notes par dossier": "notes per file",
  "constats de signaux par dossier": "signal findings per file",
  "versions de seuils": "thresholds versions",
  "versions de correspondance": "mapping versions",
  "versions de plan": "plan versions",
  créanciers: "creditors",
  "événements de négociation": "negotiation events",
  "modèles de check-list": "checklist templates",
  "versions de modèle de check-list": "checklist template versions",
  "activations de check-list": "checklist activations",
  "lots de réponses de check-list": "checklist response batches",
  "le chef de la mission": "the engagement manager",
  "le directeur de la mission ou un associé": "the engagement director or a partner",
  "un associé": "a partner",
  "renvoie une notation en brouillon": "return a rating to draft",
  "publie une notation": "publish a rating",
  "valide une version de grille": "approve a grid version",
  "clôt une session de calibrage": "close a calibration session",
  "valide un item de la banque": "approve a bank item",
};

/**
 * Messages à partie variable : motif sur le message français, rendu anglais à partir des groupes
 * capturés (chaque groupe est lui-même traduit s'il figure dans `MESSAGES_EN`). Les motifs précis
 * d'abord ; les génériques « … introuvable. » restent après tout motif qui finit aussi par
 * « introuvable. ».
 */
export const MOTIFS_EN: ReadonlyArray<MotifEn> = [
  ...MOTIFS_SPECIFIQUES_EN,
  [/^(.+) introuvable\.$/, (quoi) => `${quoi} not found.`],
  [/^(.+) introuvable\b/, (quoi) => `${quoi} not found.`],
  // Dernier recours : « CODE : message » (journal d'import) ; le message est traduit s'il est connu.
  [/^([A-Za-z0-9_.-]+) : (.+)$/, (code, message) => `${code}: ${message}`],
];
