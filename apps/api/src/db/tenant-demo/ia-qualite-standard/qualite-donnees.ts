import type { ClasseRisque } from "@missionpilot/engines";
import type { CleMission } from "./commun.js";
import type { Theme } from "./qualite-elements.js";

/*
 * Données du module « qualité » : livrables suivis par mission (suivis qualité, QUA-01 à QUA-04) et
 * définition de terminé révisée. Textes fictifs, en français. Les livrables sont de type `etat` ou
 * `autre` (opaques pour le module qualité : l'auteur et l'identifiant sont portés par le suivi,
 * aucun contenu d'un autre module n'est requis).
 */

export interface SuiviSpec {
  /** Clé stable du livrable (avec la mission, elle fixe l'identifiant du livrable). */
  cle: string;
  mission: CleMission;
  type: "etat" | "autre";
  classe: ClasseRisque;
  libelle: string;
  theme: Theme;
  /** Ouverture : jours ouvrés après le début (`debut`) ou avant la fin (`fin`, négatif) de la mission. */
  depuis: "debut" | "fin";
  jours: number;
  etat: "brouillon" | "en_revue" | "valide" | "signe";
  /** Étapes humaines (hors signature) franchies pour un suivi en revue. */
  etapes?: number;
  /** Items à attester déjà attestés (suivi en revue de type état) ; défaut : tous. */
  attestes?: number;
  /** R2 : signature facultative d'un livrable validé (statut « signé »). */
  /** Premier contrôle « à attester » (aucun chiffre déposé), chiffres déposés ensuite. */
  reverification?: boolean;
  /** Un chiffre sans source vérifiée : non-conformité ouverte, le suivi reste en revue. */
  nonConforme?: boolean;
  /** Relèvement de classe motivé (classe de départ = minimale du type). */
  releve?: string;
}

export const SUIVIS: readonly SuiviSpec[] = [
  {
    cle: "diag",
    mission: "plan-sicafe",
    type: "autre",
    classe: "R2",
    libelle: "Diagnostic stratégique et analyse SWOT — SICAFE",
    theme: "plan",
    depuis: "debut",
    jours: 52,
    etat: "signe",
    releve: "Livrable présenté au comité de direction du client.",
  },
  {
    cle: "projections",
    mission: "plan-sicafe",
    type: "etat",
    classe: "R3",
    libelle: "Projections financières 2025-2028 (compte de résultat et trésorerie prévisionnels)",
    theme: "projections",
    depuis: "fin",
    jours: -34,
    etat: "signe",
    reverification: true,
  },
  {
    cle: "plan-final",
    mission: "plan-sicafe",
    type: "autre",
    classe: "R3",
    libelle: "Plan stratégique 2025-2028 — version finale remise au conseil d'administration",
    theme: "plan",
    depuis: "fin",
    jours: -14,
    etat: "signe",
    releve: "Livrable remis au conseil d'administration : revue complète.",
  },
  {
    cle: "etats",
    mission: "notation-sahel-coton",
    type: "etat",
    classe: "R3",
    libelle: "États financiers retraités 2021-2023 — Sahel Coton",
    theme: "retraitement",
    depuis: "debut",
    jours: 26,
    etat: "signe",
  },
  {
    cle: "note",
    mission: "notation-sahel-coton",
    type: "autre",
    classe: "R2",
    libelle: "Note de notation et synthèse des facteurs de risque",
    theme: "notation",
    depuis: "fin",
    jours: -12,
    etat: "signe",
    releve: "Note diffusée à l'établissement prêteur.",
  },
  {
    cle: "tresorerie",
    mission: "redressement-wouri",
    type: "etat",
    classe: "R3",
    libelle: "Plan de trésorerie à 13 semaines — Brasseries du Wouri",
    theme: "tresorerie",
    depuis: "debut",
    jours: 18,
    etat: "signe",
  },
  {
    cle: "plan-red",
    mission: "redressement-wouri",
    type: "autre",
    classe: "R3",
    libelle: "Plan de redressement soumis au comité des créanciers",
    theme: "plan",
    depuis: "debut",
    jours: 85,
    etat: "signe",
    releve: "Plan opposable aux créanciers : revue complète.",
  },
  {
    cle: "bilan",
    mission: "redressement-wouri",
    type: "autre",
    classe: "R2",
    libelle: "Bilan de clôture du redressement",
    theme: "note",
    depuis: "fin",
    jours: -9,
    etat: "signe",
    releve: "Bilan remis à la direction générale.",
  },
  {
    cle: "ebitda",
    mission: "dd-mboa",
    type: "etat",
    classe: "R3",
    libelle: "Retraitement de l'EBITDA et dette nette ajustée — Mboa Solaire",
    theme: "retraitement",
    depuis: "debut",
    jours: 21,
    etat: "signe",
    reverification: true,
  },
  {
    cle: "rapport-dd",
    mission: "dd-mboa",
    type: "autre",
    classe: "R3",
    libelle: "Rapport de due diligence financière — version finale",
    theme: "rapport",
    depuis: "fin",
    jours: -20,
    etat: "signe",
    releve: "Rapport destiné au comité d'investissement : revue complète.",
  },
  {
    cle: "synthese",
    mission: "dd-mboa",
    type: "autre",
    classe: "R2",
    libelle: "Synthèse exécutive pour le comité d'investissement",
    theme: "rapport",
    depuis: "fin",
    jours: -8,
    etat: "signe",
    releve: "Document client.",
  },
  {
    cle: "modele",
    mission: "bp-atlantique",
    type: "etat",
    classe: "R3",
    libelle: "Modèle financier du business plan bancable sur cinq ans",
    theme: "projections",
    depuis: "debut",
    jours: 38,
    etat: "signe",
  },
  {
    cle: "bp",
    mission: "bp-atlantique",
    type: "autre",
    classe: "R3",
    libelle: "Business plan bancable — dossier de financement",
    theme: "plan",
    depuis: "fin",
    jours: -16,
    etat: "signe",
    releve: "Dossier remis aux banques : revue complète.",
  },
  {
    cle: "annexes",
    mission: "bp-atlantique",
    type: "autre",
    classe: "R1",
    libelle: "Annexes méthodologiques et hypothèses macroéconomiques",
    theme: "note",
    depuis: "fin",
    jours: -22,
    etat: "valide",
  },
  {
    cle: "diag-baobab",
    mission: "plan-baobab",
    type: "autre",
    classe: "R2",
    libelle: "Diagnostic stratégique — Baobab Assurances",
    theme: "plan",
    depuis: "debut",
    jours: 24,
    etat: "signe",
    releve: "Livrable présenté au comité exécutif du client.",
  },
  {
    cle: "projections-baobab",
    mission: "plan-baobab",
    type: "etat",
    classe: "R3",
    libelle: "Hypothèses de croissance et projections de primes 2026-2030",
    theme: "projections",
    depuis: "debut",
    jours: 62,
    etat: "en_revue",
    etapes: 2,
  },
  {
    cle: "diag-gabon",
    mission: "redressement-gabon",
    type: "etat",
    classe: "R3",
    libelle: "Diagnostic de trésorerie et position des créanciers — Gabon Offshore Services",
    theme: "tresorerie",
    depuis: "debut",
    jours: 30,
    etat: "en_revue",
    etapes: 1,
  },
  {
    cle: "cadrage-gabon",
    mission: "redressement-gabon",
    type: "autre",
    classe: "R2",
    libelle: "Note de cadrage de la négociation avec les créanciers",
    theme: "note",
    depuis: "debut",
    jours: 42,
    etat: "valide",
    releve: "Note transmise au conseil du client.",
  },
  {
    cle: "etats-lot1",
    mission: "notation-banque-sahel",
    type: "etat",
    classe: "R3",
    libelle: "États financiers retraités des PME du portefeuille — lot 1",
    theme: "retraitement",
    depuis: "debut",
    jours: 28,
    etat: "en_revue",
    etapes: 0,
    attestes: 1,
    nonConforme: true,
  },
  {
    cle: "grille-lot1",
    mission: "notation-banque-sahel",
    type: "autre",
    classe: "R3",
    libelle: "Grille de notation du portefeuille PME — lot 1",
    theme: "notation",
    depuis: "debut",
    jours: 34,
    etat: "en_revue",
    etapes: 1,
    releve: "Notation destinée à un établissement de crédit : revue complète.",
  },
  {
    cle: "entretiens",
    mission: "flash-teranga",
    type: "autre",
    classe: "R1",
    libelle: "Compte rendu des entretiens de cadrage (version de travail)",
    theme: "note",
    depuis: "debut",
    jours: 11,
    etat: "brouillon",
  },
];

/** Révision de la définition de terminé d'un état financier (versionnée en ajout seul). */
export const DEFINITION_ETAT_V2 = {
  date: "2026-02-10",
  item: {
    code: "retraitements_documentes",
    libelle:
      "Les retraitements des comptes (normes comptables locales vers analyse financière) sont documentés et justifiés",
  },
};

/** Définitions amorcées pour les types lus par d'autres modules (date de première utilisation). */
export const DEFINITIONS_AMORCEES: { type: "plan" | "notation" | "rapport"; date: string }[] = [
  { type: "plan", date: "2024-11-04" },
  { type: "notation", date: "2025-02-03" },
  { type: "rapport", date: "2025-04-30" },
];
