/**
 * Lot 3c (vague 4) : moteurs purs des canaux externes SIMULÉS (WhatsApp, SMS de repli,
 * transcription vocale, signature électronique). Fonctions pures, sans E/S, sans horloge cachée
 * et sans `node:crypto` (le hachage est injecté). Aucun service externe ni donnée réelle : les
 * ports et fournisseurs simulés vivent dans `apps/api/src/canaux`.
 */
export * from "./erreurs";
export * from "./numero";
export * from "./reponse";
export * from "./autorisation";
export * from "./statut-envoi";
export * from "./gabarits";
export * from "./synthese";
export * from "./saisie-kpi";
export * from "./transcription";
export * from "./signature";
