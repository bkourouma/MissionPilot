import type { NatureRelationClient } from "@missionpilot/shared";
import type { CleClient } from "../cles.js";
import type { CleMission } from "./commun.js";

/*
 * Données « côté client » du module qualité : relations déclarées entre clients (conflits
 * d'intérêts, QUA-07), évaluations d'acceptation de mission et satisfaction (QUA-08). Noms et
 * propos fictifs. Les dates sont celles de l'activité du cabinet (jamais postérieures à
 * « aujourd'hui »).
 */

export interface RelationSpec {
  cle: string;
  client: CleClient;
  lie: CleClient;
  nature: NatureRelationClient;
  note: string;
  /** Déclarée par (compte) à cette date. */
  date: string;
  /** Retrait éventuel : date et compte (qualite.signer). */
  retrait?: { date: string };
}

export const RELATIONS: readonly RelationSpec[] = [
  {
    cle: "sicafe-export",
    client: "sicafe",
    lie: "sicafe-export",
    nature: "meme_groupe",
    note: "Filiale export détenue à 100 % par SICAFE : déclarée à l'ouverture du dossier de groupe.",
    date: "2024-10-15",
  },
  {
    cle: "sicafe-transformation",
    client: "sicafe",
    lie: "sicafe-transformation",
    nature: "meme_groupe",
    note: "Filiale de transformation, contrôlée par SICAFE.",
    date: "2024-10-15",
  },
  {
    cle: "wouri",
    client: "brasseries-wouri",
    lie: "wouri-distribution",
    nature: "meme_groupe",
    note: "Filiale de distribution des Brasseries du Wouri.",
    date: "2025-02-20",
  },
  {
    cle: "baobab-mboa",
    client: "baobab-assurances",
    lie: "mboa-solaire",
    nature: "investisseur_cible",
    note: "Baobab Assurances étudie une prise de participation minoritaire dans Mboa Solaire.",
    date: "2025-08-12",
    retrait: { date: "2026-04-02" },
  },
  {
    cle: "coton-retail",
    client: "sahel-coton",
    lie: "atlantique-retail",
    nature: "concurrent",
    note: "Concurrence supposée sur l'approvisionnement textile : à confirmer.",
    date: "2026-03-04",
    retrait: { date: "2026-03-06" },
  },
  {
    cle: "sahel-baobab",
    client: "banque-sahel",
    lie: "baobab-assurances",
    nature: "concurrent",
    note: "Offres de bancassurance concurrentes sur la zone UEMOA.",
    date: "2026-05-20",
  },
];

export interface AcceptationSpec {
  mission: CleMission;
  /** Facteurs de risque cochés (codes de `FACTEURS_RISQUE_CLIENT`). */
  facteurs: string[];
  /** Évaluation « en attente » préalable par le chef de mission (jours avant la décision). */
  attente: number;
  /** Décision (qualite.signer) ; absente : la mission reste en attente de décision. */
  decision?: "acceptee" | "acceptee_sous_conditions";
  motif?: string;
  /** Jours avant la signature (ou le début) de la mission pour la décision. */
  avant: number;
  /** Niveau retenu relevé par le relecteur au-dessus du niveau calculé. */
  releve?: "moyen" | "eleve";
}

export const ACCEPTATIONS: readonly AcceptationSpec[] = [
  {
    mission: "plan-sicafe",
    facteurs: [],
    attente: 5,
    decision: "acceptee",
    motif:
      "Deux filiales du groupe (export et transformation) sont déclarées : aucune mission en cours pour elles, la mission porte sur la holding seule.",
    avant: 6,
  },
  {
    mission: "notation-sahel-coton",
    facteurs: ["secteur_reglemente"],
    attente: 4,
    decision: "acceptee",
    avant: 5,
  },
  {
    mission: "redressement-wouri",
    facteurs: ["client_en_difficulte", "dependance_honoraires"],
    attente: 6,
    decision: "acceptee_sous_conditions",
    motif:
      "Acompte de 30 % à la signature, comité de suivi mensuel avec le directeur de mission, périmètre limité au plan de redressement et exclusion de toute reprise de gestion. Filiale de distribution du groupe déclarée, sans mission en cours.",
    avant: 4,
  },
  {
    mission: "dd-mboa",
    facteurs: ["gouvernance_opaque"],
    attente: 5,
    decision: "acceptee_sous_conditions",
    motif:
      "Un lien d'investisseur avec Baobab Assurances est déclaré. Baobab n'est pas client du cabinet à ce jour ; muraille de confidentialité entre les équipes si une mission lui est confiée, et information écrite des deux parties.",
    avant: 7,
    releve: "eleve",
  },
  {
    mission: "bp-atlantique",
    facteurs: ["information_incomplete"],
    attente: 4,
    decision: "acceptee",
    avant: 5,
  },
  {
    mission: "plan-baobab",
    facteurs: [],
    attente: 3,
    decision: "acceptee",
    motif:
      "Concurrence déclarée avec la Banque du Sahel (relation du 20 mai 2026) : ce client n'a aucune mission en cours au cabinet à ce jour ; équipes distinctes si une mission lui est confiée.",
    avant: 6,
  },
  {
    mission: "redressement-gabon",
    facteurs: ["pays_a_risque", "client_en_difficulte"],
    attente: 7,
    decision: "acceptee_sous_conditions",
    motif:
      "Contrôles de connaissance du client renforcés, paiement des honoraires par avance et revue du directeur de mission à chaque jalon.",
    avant: 5,
  },
  {
    mission: "notation-banque-sahel",
    facteurs: ["secteur_reglemente"],
    attente: 4,
    decision: "acceptee_sous_conditions",
    motif:
      "Concurrence déclarée avec Baobab Assurances (mission de plan stratégique en cours) : équipes distinctes, aucun échange d'information entre les deux missions.",
    avant: 6,
  },
  { mission: "flash-teranga", facteurs: [], attente: 2, decision: "acceptee", avant: 4 },
  {
    mission: "plan-sicafe-export",
    facteurs: [],
    attente: 3,
    decision: "acceptee",
    motif: "Même groupe que SICAFE (déclaré) : périmètre distinct, aucune mission SICAFE en cours.",
    avant: 8,
  },
];

/** Évaluation faite AUJOURD'HUI par les routes : mission en proposition, décision encore en attente. */
export const ACCEPTATION_VIVE = {
  mission: "dd-wouri-distribution" as CleMission,
  facteurs: ["secteur_reglemente", "dependance_honoraires"],
};

export interface NotesSatisfaction {
  mission: CleMission;
  /** Notes des jalons dans l'ordre (les jalons sans date ou futurs sont ignorés). */
  jalons: number[];
  /** Note de clôture (mission terminée) et correction éventuelle. */
  cloture?: { note: number; correction?: number };
  repondant: string;
  commentaires: string[];
}

export const SATISFACTIONS: readonly NotesSatisfaction[] = [
  {
    mission: "plan-sicafe",
    jalons: [9, 8, 9],
    cloture: { note: 9 },
    repondant: "Kouadio Brou, directeur général de SICAFE",
    commentaires: [
      "Diagnostic très partagé par le comité de direction.",
      "Équipe disponible et rigoureuse.",
      "Plan clair, utile pour le conseil d'administration.",
    ],
  },
  {
    mission: "notation-sahel-coton",
    jalons: [8, 8],
    cloture: { note: 8 },
    repondant: "Awa Sanogo, directrice financière de Sahel Coton",
    commentaires: [
      "Méthode de notation bien expliquée.",
      "Délais respectés malgré la collecte des états financiers.",
    ],
  },
  {
    mission: "redressement-wouri",
    jalons: [7, 5, 8, 8],
    cloture: { note: 7 },
    repondant: "Ernest Mbarga, président des Brasseries du Wouri",
    commentaires: [
      "Rythme de travail soutenu mais utile.",
      "Tensions avec les créanciers mal anticipées dans le calendrier.",
      "Le plan de trésorerie rassure enfin les fournisseurs.",
      "Bonne conduite des négociations.",
    ],
  },
  {
    mission: "dd-mboa",
    jalons: [9, 9],
    cloture: { note: 9 },
    repondant: "Léonie Tchakounté, directrice de Mboa Solaire",
    commentaires: [
      "Compréhension rapide de notre modèle économique.",
      "Rapport exploitable par le comité d'investissement.",
    ],
  },
  {
    mission: "bp-atlantique",
    jalons: [8, 9],
    cloture: { note: 8, correction: 9 },
    repondant: "Samba Diop, directeur général d'Atlantique Retail",
    commentaires: ["Modèle financier solide.", "Dossier bien reçu par les banques."],
  },
  {
    mission: "plan-baobab",
    jalons: [9],
    repondant: "Mariam Konaté, secrétaire générale de Baobab Assurances",
    commentaires: ["Très bon démarrage, ateliers de qualité."],
  },
  {
    mission: "redressement-gabon",
    jalons: [8],
    repondant: "Steeve Ondo, directeur financier de Gabon Offshore Services",
    commentaires: ["Réactivité appréciée dans un contexte tendu."],
  },
  {
    mission: "notation-banque-sahel",
    jalons: [7],
    repondant: "Fatou Cissé, responsable du risque PME à la Banque du Sahel",
    commentaires: ["Grille intéressante, quelques précisions attendues sur le périmètre."],
  },
];
