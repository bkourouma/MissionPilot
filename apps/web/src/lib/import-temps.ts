/**
 * Import de l'historique des temps (TPS-10) depuis un classeur Excel .xlsx ou un fichier CSV :
 * contrôle local du fichier, étapes de l'écran (simulation obligatoire, confirmation explicite,
 * exécution), messages d'erreur de l'API et résumé du rapport. Logique pure (hors
 * `preparerSource`, `envoyerImport` et `telechargerModele`, qui lisent un fichier ou appellent
 * l'API), testée dans `import-temps.test.ts`.
 *
 * Le contrôle local donne un retour immédiat et épargne la connexion ; l'API reste seule juge :
 * elle relit le fichier, contrôle chaque ligne et refuse l'exécution d'un import qui comporte la
 * moindre erreur (tout ou rien). Rien n'est conservé dans le navigateur (ni stockage local, ni
 * URL) : le contenu simulé ne vit que dans l'état de la page.
 *
 * Sous-modules ré-exportés ici : `import-temps-fichier` (contrôle local), `-source` (envoi à
 * l'API, rapport, modèle), `-etapes` (état de l'écran), `-erreurs` et `-rapport` (résumé).
 */
export type { RapportImport } from "./temps-admin";
export type { FormatImport } from "./import-temps-fichier";
export {
  AIDE_FICHIER_IMPORT,
  controlerFichierImport,
  formatDe,
  IMPORT_CSV_MAX_OCTETS,
  IMPORT_EXCEL_MAX_OCTETS,
  TYPES_IMPORT,
  type ControleImport,
} from "./import-temps-fichier";
export * from "./import-temps-source";
export * from "./import-temps-etapes";
export * from "./import-temps-erreurs";
export * from "./import-temps-rapport";
