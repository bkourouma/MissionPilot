/**
 * Canaux externes SIMULÉS (lot 3c, ADR-008) : WhatsApp et SMS de repli, consentements, journal
 * d'envois, synthèse hebdomadaire du dirigeant, saisies de KPI reçues par message. Logique pure,
 * testée dans `canaux.test.ts`.
 *
 * Règle ferme : TOUT est simulé. Aucun message n'est réellement envoyé ; chaque écran qui décrit
 * un compte ou un envoi affiche « Simulé : aucun envoi réel » (`TEXTES_CANAUX.bandeauSimule`).
 * Le navigateur ne voit jamais un numéro de téléphone complet (masque seulement, fourni par
 * l'API), jamais un texte de message reçu, jamais un coût sans le droit financier (FIN-02 : champ
 * absent). Les droits testés ici sont un confort d'affichage ; l'API reste seule juge.
 */
import {
  PLAFONDS_CANAUX,
  TEXTES_CANAUX,
  type CanalMessagerie,
  type CompteCanalApi,
  type ConsentementCourantCanal,
  type DestinataireCanalApi,
  type EnvoiCanalApi,
  type MessageSimulateurApi,
  type SaisieKpiApi,
} from "@missionpilot/shared";

export * from "./canaux-chemins";
export * from "./canaux-libelles";
export * from "./canaux-comptes";
export * from "./canaux-numeros";
export * from "./canaux-journal";
export * from "./canaux-saisies";
export * from "./canaux-simulateur";
export * from "./canaux-onglets";

export { PLAFONDS_CANAUX, TEXTES_CANAUX };
export type {
  CanalMessagerie,
  CompteCanalApi,
  ConsentementCourantCanal,
  DestinataireCanalApi,
  EnvoiCanalApi,
  MessageSimulateurApi,
  SaisieKpiApi,
};
