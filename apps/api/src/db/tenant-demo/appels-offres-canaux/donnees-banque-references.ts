import type { CleClient, CleCompte } from "../cles.js";
import type { CleMissionCasting } from "./outils.js";

/*
 * Références du cabinet (banque d'AO) : les cinq missions terminées du casting (liées à leur
 * mission et à leur client) et trois références historiques apportées par l'équipe fondatrice.
 * Organismes, clients historiques et bailleurs FICTIFS. Montants du marché en unités de la devise.
 */

export type RoleCabinet = "seul" | "chef_de_file" | "membre" | "sous_traitant";

export interface ContenuReference {
  titre: string;
  client_nom?: string;
  pays: string;
  secteurs: string[];
  bailleur: string | null;
  montant: number;
  devise: "XOF" | "XAF";
  date_debut: string;
  date_fin: string | null;
  role_cabinet: RoleCabinet;
  description: string;
}

export interface AttestationDemo {
  type: "attestation_bonne_execution" | "proces_verbal_reception" | "contrat" | "autre";
  date: string;
  emetteur: string;
  fichier: string;
  lignes: string[];
  /** Motif de retrait : la pièce est ajoutée puis retirée (remplacée par la suivante). */
  retrait?: string;
  ajoutePar: CleCompte;
}

export interface ReferenceDemo {
  createur: CleCompte;
  mission?: CleMissionCasting;
  client?: CleClient;
  contenu: ContenuReference;
  /** Version 2 : champs modifiés, motif et auteur. */
  maj?: { motif: string; auteur: CleCompte; changes: Partial<ContenuReference> };
  attestations: AttestationDemo[];
}

export const REFERENCES_DEMO: readonly ReferenceDemo[] = [
  {
    createur: "associe.2",
    mission: "planSicafe",
    client: "sicafe",
    contenu: {
      titre: "Plan stratégique 2025-2028 d'un groupe agro-industriel ivoirien",
      pays: "CI",
      secteurs: ["Agro-industrie", "Stratégie"],
      bailleur: null,
      montant: 62_000_000,
      devise: "XOF",
      date_debut: "2024-11-04",
      date_fin: "2025-04-30",
      role_cabinet: "seul",
      description:
        "Définition de la vision, de la cascade d'objectifs et du plan d'action 2025-2028 de la holding et de ses deux filiales ; ateliers de direction et tableau de bord de pilotage.",
    },
    maj: {
      motif: "Avenant n° 1 : ajout d'un atelier de déploiement auprès des filiales",
      auteur: "associe",
      changes: { montant: 66_200_000 },
    },
    attestations: [
      {
        type: "attestation_bonne_execution",
        date: "2025-05-20",
        emetteur: "Direction générale de la Société Ivoirienne de Café et Cacao",
        fichier: "attestation-sicafe-plan-strategique.pdf",
        lignes: [
          "Attestation de bonne execution - plan strategique 2025-2028",
          "Mission executee dans les delais et a la satisfaction de la direction generale.",
        ],
        ajoutePar: "chef.mission",
      },
      {
        type: "proces_verbal_reception",
        date: "2025-04-30",
        emetteur: "Direction de la stratégie de la Société Ivoirienne de Café et Cacao",
        fichier: "pv-reception-sicafe-livrable-final.pdf",
        lignes: [
          "Proces-verbal de reception du livrable final",
          "Plan strategique et tableau de bord recus sans reserve.",
        ],
        ajoutePar: "directeur.mission",
      },
    ],
  },
  {
    createur: "associe",
    mission: "notationSahel",
    client: "sahel-coton",
    contenu: {
      titre: "Notation financière d'un groupe cotonnier malien",
      pays: "ML",
      secteurs: ["Agro-industrie", "Notation financière"],
      bailleur: null,
      montant: 28_000_000,
      devise: "XOF",
      date_debut: "2025-02-03",
      date_fin: "2025-06-20",
      role_cabinet: "seul",
      description:
        "Notation financière de la société à partir de ses états financiers et de sa trésorerie ; rapport de notation et recommandations remis à la direction et aux banquiers.",
    },
    attestations: [
      {
        type: "attestation_bonne_execution",
        date: "2025-07-08",
        emetteur: "Direction financière de Sahel Coton Mali",
        fichier: "attestation-sahel-coton-notation.pdf",
        lignes: [
          "Attestation de bonne execution - notation financiere",
          "Rapport de notation remis dans les delais convenus.",
        ],
        ajoutePar: "chef.mission.2",
      },
    ],
  },
  {
    createur: "associe.2",
    mission: "redressementWouri",
    client: "brasseries-wouri",
    contenu: {
      titre: "Plan de redressement d'un groupe brassicole camerounais",
      pays: "CM",
      secteurs: ["Industrie", "Redressement"],
      bailleur: null,
      montant: 78_000_000,
      devise: "XAF",
      date_debut: "2025-03-10",
      date_fin: "2025-11-14",
      role_cabinet: "chef_de_file",
      description:
        "Diagnostic de la situation financière, analyse des causes de la dégradation, plan de redressement en trois volets (trésorerie, coûts, organisation) et suivi de sa mise en œuvre pendant huit mois.",
    },
    maj: {
      motif: "Date de fin ramenée à la réception définitive du bilan de clôture",
      auteur: "associe",
      changes: { date_fin: "2025-11-21" },
    },
    attestations: [
      {
        type: "attestation_bonne_execution",
        date: "2025-12-05",
        emetteur: "Présidence du conseil d'administration de Brasseries du Wouri",
        fichier: "attestation-brasseries-wouri-redressement.pdf",
        lignes: [
          "Attestation de bonne execution - plan de redressement",
          "Le plan a ete mis en oeuvre et la tresorerie retablie.",
        ],
        ajoutePar: "chef.mission",
      },
    ],
  },
  {
    createur: "associe",
    mission: "ddMboa",
    client: "mboa-solaire",
    contenu: {
      titre: "Due diligence financière et opérationnelle d'un opérateur solaire",
      pays: "CM",
      secteurs: ["Énergie", "Due diligence"],
      bailleur: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
      montant: 38_000_000,
      devise: "XAF",
      date_debut: "2025-09-01",
      date_fin: "2025-12-19",
      role_cabinet: "seul",
      description:
        "Revue de due diligence financière, opérationnelle et contractuelle d'un opérateur de solutions solaires dans le cadre d'une entrée au capital d'un fonds d'investissement.",
    },
    attestations: [
      {
        type: "attestation_bonne_execution",
        date: "2026-01-12",
        emetteur: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
        fichier: "attestation-mboa-solaire-dd-projet.pdf",
        lignes: [
          "Projet d'attestation - non signe",
          "Version provisoire remplacee par l'attestation signee.",
        ],
        retrait: "Version non signée par le fonds : remplacée par l'attestation signée.",
        ajoutePar: "associe",
      },
      {
        type: "attestation_bonne_execution",
        date: "2026-01-26",
        emetteur: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
        fichier: "attestation-mboa-solaire-dd-signee.pdf",
        lignes: [
          "Attestation de bonne execution - due diligence",
          "Rapport de due diligence recu et accepte par le comite d'investissement.",
        ],
        ajoutePar: "associe",
      },
    ],
  },
  {
    createur: "associe.2",
    mission: "businessPlanAtlantique",
    client: "atlantique-retail",
    contenu: {
      titre: "Business plan bancable d'une filiale africaine de distribution",
      pays: "CI",
      secteurs: ["Distribution", "Business plan"],
      bailleur: null,
      montant: 31_500_000,
      devise: "XOF",
      date_debut: "2026-01-12",
      date_fin: "2026-05-29",
      role_cabinet: "seul",
      description:
        "Business plan et modèle financier à cinq ans pour le financement bancaire de l'extension du réseau de magasins d'une filiale ivoirienne d'un groupe de distribution français.",
    },
    attestations: [
      {
        type: "contrat",
        date: "2026-01-05",
        emetteur: "Atlantique Retail Group SAS",
        fichier: "contrat-atlantique-retail-business-plan.pdf",
        lignes: [
          "Contrat de prestation - business plan bancable",
          "Copie du contrat signe des deux parties (extrait).",
        ],
        ajoutePar: "chef.mission.2",
      },
    ],
  },
  {
    createur: "associe",
    contenu: {
      titre: "Diagnostic organisationnel d'une mutuelle d'assurance",
      client_nom: "Mutuelle d'assurance du Sahel",
      pays: "SN",
      secteurs: ["Assurance", "Organisation"],
      bailleur: null,
      montant: 24_000_000,
      devise: "XOF",
      date_debut: "2023-03-06",
      date_fin: "2023-07-14",
      role_cabinet: "membre",
      description:
        "Référence apportée par l'équipe fondatrice (ancien cabinet des associés) : diagnostic de l'organisation et du contrôle interne d'une mutuelle d'assurance.",
    },
    attestations: [],
  },
  {
    createur: "associe.2",
    contenu: {
      titre: "Étude de faisabilité d'une centrale solaire pour une coopérative électrique",
      client_nom: "Coopérative électrique du Nord",
      pays: "CM",
      secteurs: ["Énergie", "Étude de faisabilité"],
      bailleur: "Banque Régionale de Développement des Énergies (fictive)",
      montant: 41_000_000,
      devise: "XAF",
      date_debut: "2023-09-11",
      date_fin: "2024-01-26",
      role_cabinet: "sous_traitant",
      description:
        "Référence historique de l'équipe fondatrice : étude technico-économique et plan de financement d'une centrale solaire de 5 MW, financée par un bailleur régional.",
    },
    attestations: [],
  },
  {
    createur: "associe.2",
    contenu: {
      titre: "Programme de formation des cadres d'une institution de microfinance",
      client_nom: "Institution de microfinance du Faso",
      pays: "BF",
      secteurs: ["Banque et microfinance", "Formation"],
      bailleur: null,
      montant: 18_000_000,
      devise: "XOF",
      date_debut: "2024-02-05",
      date_fin: "2024-07-19",
      role_cabinet: "seul",
      description:
        "Référence historique : conception et animation de six modules de formation (gestion du risque de crédit, contrôle interne) pour quatre-vingts cadres.",
    },
    attestations: [
      {
        type: "attestation_bonne_execution",
        date: "2024-08-02",
        emetteur: "Direction générale de l'Institution de microfinance du Faso",
        fichier: "attestation-microfinance-faso-formation.pdf",
        lignes: [
          "Attestation de bonne execution - programme de formation",
          "Six modules animes, evaluation moyenne de 4,5 sur 5.",
        ],
        ajoutePar: "associe.2",
      },
    ],
  },
];
