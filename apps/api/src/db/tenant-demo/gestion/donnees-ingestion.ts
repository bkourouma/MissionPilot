import type { CleClient } from "../cles.js";
import type { CleMission } from "./casting.js";

/*
 * Données du module INGESTION de la phase `gestion` : documents du cabinet à lire (états financiers en
 * tableur, rapports et salle de données de due diligence, documents historiques du standard). Ce sont
 * des JEUX DE DONNÉES DE DÉMONSTRATION : les chiffres des tableurs sont fixés ici (bilan et compte de
 * résultat équilibrés par construction, voir ingestion-fichiers.ts) et ceux des rapports sont écrits
 * dans le texte des pages ; AUCUN chiffre ne vient d'un modèle de langage. L'« IA » est un gabarit
 * déterministe : les lignes de lecture proposées sont dérivées du texte des pages ci-dessous, puis
 * relues et vérifiées par le moteur (`lireLecturesIa`, `lirePropositionIa`) comme pour une vraie IA.
 * Textes en ASCII étendu latin1 (le PDF fictif est en WinAnsi) : pas de guillemets ni d'apostrophes
 * typographiques.
 */

export type VarianteEtat = "equilibre" | "ecart_leger" | "ecart_grave";
export type SuiteEtat = "auto" | "accepter_ecart" | "rejeter";

export interface EtatDoc {
  /** Mission dont le chef de mission téléverse le document. */
  mission: CleMission;
  client: CleClient;
  exercice: number;
  produits: number;
  charges: number;
  /** Nom du fichier téléversé : clé naturelle du document (avec le client). */
  nom: string;
  jour: string;
  variante: VarianteEtat;
  suite: SuiteEtat;
  jourDecision?: string;
  motif?: string;
}

export const ETATS_A_LIRE: readonly EtatDoc[] = [
  {
    mission: "sahel-coton-notation",
    client: "sahel-coton",
    exercice: 2023,
    produits: 31_600_000_000,
    charges: 30_400_000_000,
    nom: "Liasse SAHEL COTON 2023.xlsx",
    jour: "2025-02-18",
    variante: "equilibre",
    suite: "auto",
  },
  {
    mission: "sahel-coton-notation",
    client: "sahel-coton",
    exercice: 2024,
    produits: 35_900_000_000,
    charges: 34_100_000_000,
    nom: "Liasse SAHEL COTON 2024.xlsx",
    jour: "2025-02-20",
    variante: "equilibre",
    suite: "auto",
  },
  {
    mission: "baobab-plan",
    client: "baobab-assurances",
    exercice: 2025,
    produits: 24_800_000_000,
    charges: 23_100_000_000,
    nom: "Etats financiers BAOBAB ASSURANCES 2025.xlsx",
    jour: "2026-06-24",
    variante: "ecart_leger",
    suite: "accepter_ecart",
    jourDecision: "2026-06-26",
    motif:
      "Ecart de mille francs sur le total du passif, imputable a un arrondi de la liasse du client ; etat retenu pour le diagnostic.",
  },
  {
    mission: "banque-sahel-notation",
    client: "banque-sahel",
    exercice: 2025,
    produits: 18_400_000_000,
    charges: 15_900_000_000,
    nom: "Etats financiers BANQUE DU SAHEL 2025.xlsx",
    jour: "2026-09-02",
    variante: "equilibre",
    suite: "auto",
  },
  {
    mission: "sicafe-export-plan",
    client: "sicafe-export",
    exercice: 2025,
    produits: 12_600_000_000,
    charges: 11_900_000_000,
    nom: "Liasse SICAFE EXPORT 2025 (premiere version).xlsx",
    jour: "2026-10-14",
    variante: "ecart_grave",
    suite: "rejeter",
    jourDecision: "2026-10-15",
    motif:
      "Le total du passif ne correspond pas au total de l'actif (ecart de plusieurs dizaines de millions) : demander au client la liasse certifiee.",
  },
  {
    mission: "sicafe-export-plan",
    client: "sicafe-export",
    exercice: 2025,
    produits: 12_600_000_000,
    charges: 11_900_000_000,
    nom: "Liasse SICAFE EXPORT 2025 (corrigee).xlsx",
    jour: "2026-10-19",
    variante: "equilibre",
    suite: "auto",
  },
];

/** Document sans état chiffré (rapport d'activité narratif) : rien d'exploitable, texte purgé ensuite. */
export const DOCUMENT_SANS_ETAT = {
  mission: "gabon-redressement" as CleMission,
  client: "gabon-offshore" as CleClient,
  exercice: 2025,
  nom: "Rapport d'activite GABON OFFSHORE 2025.xlsx",
  jour: "2026-07-10",
  lignes: [
    ["Gabon Offshore Services : rapport d'activite 2025", null, null],
    ["Effectif moyen", 412, "salaries"],
    ["Navires de support exploites", 9, "unites"],
    ["Taux de disponibilite de la flotte", 91, "pour cent"],
    ["Nouveaux contrats signes", 6, "contrats"],
    ["Jours de mer cumules", 2840, "jours"],
  ] as (string | number | null)[][],
};

/* ----- Due diligence ----- */

export type ElementLecture = [page: number, type: string, extrait: string, enonce: string];
export type SuiteLecture = "valider_corrige" | "attente" | "rejeter";

export interface LectureDoc {
  mission: CleMission;
  type: "rapport" | "salle";
  nom: string;
  jour: string;
  pages: string[][];
  resume: [page: number, texte: string][];
  elements: ElementLecture[];
  suite: SuiteLecture;
  jourDecision?: string;
  motif?: string;
  /** Précision ajoutée par la personne qui corrige le brouillon avant validation. */
  correction?: string;
}

export const LECTURES_DD: readonly LectureDoc[] = [
  {
    mission: "mboa-dd",
    type: "rapport",
    nom: "Rapport du commissaire aux comptes MBOA SOLAIRE 2024.pdf",
    jour: "2025-10-06",
    pages: [
      [
        "RAPPORT GENERAL DU COMMISSAIRE AUX COMPTES - MBOA SOLAIRE SA",
        "Exercice clos le 31 decembre 2024.",
        "Le chiffre d'affaires de l'exercice atteint 4 850 000 000 FCFA.",
        "Le resultat net ressort a 380 000 000 FCFA.",
        "Les comptes sont certifies sans reserve.",
      ],
      [
        "ENGAGEMENTS ET LITIGES",
        "Un litige avec un fournisseur d'onduleurs est en cours pour 210 000 000 FCFA.",
        "La societe a donne une garantie bancaire de 600 000 000 FCFA au profit d'un client public.",
        "Trois clients representent 58 % du chiffre d'affaires.",
      ],
    ],
    resume: [
      [1, "Comptes de l'exercice certifies sans reserve par le commissaire aux comptes."],
      [
        2,
        "Un litige fournisseur et une garantie bancaire sont signales, avec une concentration de la clientele.",
      ],
    ],
    elements: [
      [
        1,
        "chiffre",
        "Le chiffre d'affaires de l'exercice atteint 4 850 000 000 FCFA.",
        "Chiffre d'affaires de 4 850 000 000 FCFA sur l'exercice.",
      ],
      [
        1,
        "fait",
        "Les comptes sont certifies sans reserve.",
        "Certification sans reserve des comptes.",
      ],
      [
        2,
        "risque",
        "Un litige avec un fournisseur d'onduleurs est en cours pour 210 000 000 FCFA.",
        "Litige fournisseur en cours pour 210 000 000 FCFA.",
      ],
      [
        2,
        "engagement",
        "La societe a donne une garantie bancaire de 600 000 000 FCFA au profit d'un client public.",
        "Garantie bancaire donnee de 600 000 000 FCFA.",
      ],
      [
        2,
        "risque",
        "Trois clients representent 58 % du chiffre d'affaires.",
        "Concentration : trois clients font 58 % du chiffre d'affaires.",
      ],
    ],
    suite: "valider_corrige",
    jourDecision: "2025-10-21",
    correction:
      "Precision du consultant : le litige concerne le lot d'onduleurs livre l'annee precedente, a rapprocher des provisions.",
  },
  {
    mission: "mboa-dd",
    type: "salle",
    nom: "Salle de donnees - contrats d'achat d'energie.pdf",
    jour: "2025-10-14",
    pages: [
      [
        "CONTRAT D'ACHAT D'ENERGIE - CENTRALE DE BONGOR",
        "Le contrat est conclu pour une duree de 15 ans.",
        "Le prix de rachat est de 62 FCFA par kilowattheure.",
        "L'acheteur peut resilier le contrat en cas de retard de mise en service de plus de 6 mois.",
      ],
    ],
    resume: [
      [
        1,
        "Contrat d'achat d'energie de longue duree avec clause de resiliation pour retard de mise en service.",
      ],
    ],
    elements: [
      [1, "fait", "Le contrat est conclu pour une duree de 15 ans.", "Duree du contrat : 15 ans."],
      [
        1,
        "risque",
        "L'acheteur peut resilier le contrat en cas de retard de mise en service de plus de 6 mois.",
        "Clause de resiliation pour retard de mise en service.",
      ],
    ],
    suite: "rejeter",
    jourDecision: "2025-10-28",
    motif:
      "La lecture melange deux contrats de la salle de donnees : le document doit etre relu apres tri des pieces.",
  },
  {
    mission: "wouri-dd",
    type: "rapport",
    nom: "Rapport de gestion WOURI DISTRIBUTION 2025.pdf",
    jour: "2026-10-12",
    pages: [
      [
        "RAPPORT DE GESTION - WOURI DISTRIBUTION SA",
        "Exercice clos le 31 decembre 2025.",
        "Le chiffre d'affaires consolide atteint 9 200 000 000 FCFA.",
        "L'endettement bancaire s'eleve a 1 750 000 000 FCFA.",
      ],
      [
        "PERSPECTIVES",
        "Le plan prevoit l'ouverture de 12 points de vente en 2026.",
        "Un contrat de distribution exclusif arrive a echeance fin 2026.",
      ],
    ],
    resume: [
      [
        1,
        "Rapport de gestion de l'exercice 2025 : activite, endettement et perspectives d'expansion.",
      ],
    ],
    elements: [
      [
        1,
        "chiffre",
        "Le chiffre d'affaires consolide atteint 9 200 000 000 FCFA.",
        "Chiffre d'affaires consolide de 9 200 000 000 FCFA.",
      ],
      [
        1,
        "chiffre",
        "L'endettement bancaire s'eleve a 1 750 000 000 FCFA.",
        "Endettement bancaire de 1 750 000 000 FCFA.",
      ],
      [
        2,
        "fait",
        "Le plan prevoit l'ouverture de 12 points de vente en 2026.",
        "Ouverture de 12 points de vente prevue en 2026.",
      ],
      [
        2,
        "risque",
        "Un contrat de distribution exclusif arrive a echeance fin 2026.",
        "Echeance d'un contrat de distribution exclusif fin 2026.",
      ],
    ],
    suite: "attente",
  },
];

/* ----- Standard (documents historiques du cabinet) ----- */

export interface StandardDoc {
  nom: string;
  jour: string;
  pages: string[][];
  /** Lignes proposées par le gabarit (format de `lirePropositionIa`), sans nombre ni monnaie. */
  lignes: string[];
  suite: "valider" | "attente";
  jourDecision?: string;
}

export const STANDARDS_HISTORIQUES: readonly StandardDoc[] = [
  {
    nom: "Guide methodologique interne - plan strategique.pdf",
    jour: "2026-03-10",
    pages: [
      [
        "GUIDE METHODOLOGIQUE INTERNE - PLAN STRATEGIQUE",
        "Etape 1 : revue documentaire et entretiens avec la direction.",
        "Etape 2 : ateliers de formulation des options strategiques.",
        "Livrable : note d'orientation validee par le comite de pilotage.",
      ],
      [
        "SUIVI DE LA MISE EN OEUVRE",
        "Un tableau de bord trimestriel suit les initiatives retenues.",
        "Risque courant : portage insuffisant par les directions metiers.",
      ],
    ],
    lignes: [
      "etape | revue_documentaire_cabinet | Revue documentaire et entretiens | 1",
      "etape | ateliers_options_cabinet | Ateliers de formulation des options | 1",
      "brique | revue_documentaire_cabinet | analyse_documents_cabinet | Analyse des documents du client | Passer en revue les documents strategiques existants | 1",
      "element | livrable | note_orientation_cabinet | Note d'orientation strategique | Note validee par le comite de pilotage | 1",
      "element | kpi_type | tableau_bord_trimestriel_cabinet | Tableau de bord trimestriel des initiatives | Suivi des initiatives retenues | 2",
      "element | risque_type | portage_directions_cabinet | Portage insuffisant par les directions metiers | Risque courant de la mise en oeuvre | 2",
      "rubrique | maturite_pilotage_cabinet | Maturite du pilotage strategique | Aucun suivi formalise | Suivi occasionnel sans responsable | Suivi regulier par la direction | Suivi structure par des indicateurs | Pilotage integre et revu en comite | 2",
    ],
    suite: "valider",
    jourDecision: "2026-03-17",
  },
  {
    nom: "Trame de rapport de diagnostic flash.pdf",
    jour: "2026-10-15",
    pages: [
      [
        "TRAME DE RAPPORT - DIAGNOSTIC FLASH",
        "Section 1 : contexte et perimetre du diagnostic.",
        "Section 2 : constats et pistes d'amelioration hierarchisees.",
        "Gabarit : presentation de restitution pour la direction generale.",
      ],
    ],
    lignes: [
      "etape | restitution_flash_cabinet | Restitution du diagnostic flash | 1",
      "element | gabarit | trame_restitution_cabinet | Trame de restitution a la direction generale | Presentation des constats et des pistes hierarchisees | 1",
      "element | livrable | rapport_constats_cabinet | Rapport de constats et de pistes d'amelioration | Constats hierarchises du diagnostic | 1",
    ],
    suite: "attente",
  },
];
