import type { CleCompteCabinet } from "../cles.js";
import type { Redacteur } from "./notation-referentiels-items.js";

/*
 * Données de l'étape « notation-referentiels » (suite) : bibliothèque d'initiatives et sessions
 * de calibrage. Les gains d'initiatives sont des observations saisies par des consultants ; les
 * niveaux de calibrage des cotations d'évaluateurs ; tout calcul est fait par les moteurs.
 */

/* ----- Bibliothèque d'initiatives (plan d'action de notation) ----- */

export interface DefImpact {
  secteur: string | null;
  taille: string | null;
  /** Gain observé, en points de score (une décimale). */
  gain: number;
  source: string;
  /** Jours avant « aujourd'hui » fictif. */
  il_y_a: number;
}

export interface DefInitiative {
  code: string;
  titre: string;
  description: string;
  dimensions: string[];
  effort: number;
  duree_mois: number;
  /** Retirée de la bibliothèque après usage (active = false). */
  retiree?: boolean;
  auteur: Redacteur;
  impacts: DefImpact[];
}

export const INITIATIVES: readonly DefInitiative[] = [
  {
    code: "tableau-de-bord-direction",
    titre: "Mettre en place un tableau de bord de direction mensuel",
    description:
      "Choisir une dizaine d'indicateurs, nommer un responsable par indicateur et réunir la direction chaque mois autour du tableau.",
    dimensions: ["pilotage"],
    effort: 2,
    duree_mois: 4,
    auteur: "chef.mission",
    impacts: [
      {
        secteur: "agro_industrie",
        taille: "pme",
        gain: 6.5,
        source: "Suivi à six mois, mission Sahel Coton",
        il_y_a: 330,
      },
      {
        secteur: "services",
        taille: "pme",
        gain: 5.0,
        source: "Retour d'expérience, mission Plan stratégique SICAFE",
        il_y_a: 190,
      },
      {
        secteur: null,
        taille: null,
        gain: 4.5,
        source: "Moyenne des missions de notation 2025",
        il_y_a: 120,
      },
    ],
  },
  {
    code: "cartographie-processus",
    titre: "Cartographier et documenter les processus clés",
    description:
      "Décrire les cinq à sept processus clés, désigner leurs pilotes et formaliser les modes opératoires critiques.",
    dimensions: ["processus", "qualite"],
    effort: 3,
    duree_mois: 6,
    auteur: "consultant",
    impacts: [
      {
        secteur: "industrie",
        taille: "pme",
        gain: 7.2,
        source: "Accompagnement d'une unité de transformation, 2025",
        il_y_a: 280,
      },
      {
        secteur: "agro_industrie",
        taille: "eti",
        gain: 5.8,
        source: "Suivi à douze mois, mission Brasseries du Wouri",
        il_y_a: 60,
      },
    ],
  },
  {
    code: "revue-strategique-trimestrielle",
    titre: "Instaurer une revue stratégique trimestrielle",
    description:
      "Réunir la direction chaque trimestre pour confronter le plan aux résultats et arbitrer les priorités.",
    dimensions: ["strategie", "pilotage"],
    effort: 2,
    duree_mois: 3,
    auteur: "consultant.2",
    impacts: [
      {
        secteur: "services",
        taille: "pme",
        gain: 4.0,
        source: "Suivi à six mois, mission Plan stratégique SICAFE",
        il_y_a: 150,
      },
      {
        secteur: "commerce",
        taille: "eti",
        gain: 3.5,
        source: "Retour d'expérience, mission Business plan Atlantique Retail",
        il_y_a: 40,
      },
      {
        secteur: null,
        taille: null,
        gain: 3.8,
        source: "Moyenne des missions de plan 2025-2026",
        il_y_a: 25,
      },
    ],
  },
  {
    code: "plan-gpec",
    titre: "Bâtir un plan de gestion prévisionnelle des compétences",
    description:
      "Recenser les postes et compétences critiques, préparer les remplaçants et relier la formation aux besoins de la stratégie.",
    dimensions: ["organisation", "engagement"],
    effort: 3,
    duree_mois: 9,
    auteur: "chef.mission.2",
    impacts: [
      {
        secteur: "services",
        taille: "eti",
        gain: 6.1,
        source: "Suivi à douze mois, mission d'organisation 2025",
        il_y_a: 210,
      },
      {
        secteur: "numerique",
        taille: "pme",
        gain: 8.4,
        source: "Accompagnement d'une société de services numériques, 2026",
        il_y_a: 35,
      },
    ],
  },
  {
    code: "programme-ecoute-clients",
    titre: "Déployer un programme d'écoute des clients",
    description:
      "Enquête annuelle de satisfaction, traitement tracé des réclamations et restitution trimestrielle à la direction.",
    dimensions: ["qualite", "positionnement"],
    effort: 2,
    duree_mois: 4,
    auteur: "associe.2",
    impacts: [
      {
        secteur: "commerce",
        taille: "pme",
        gain: 5.4,
        source: "Suivi à six mois, enseigne de distribution, 2025",
        il_y_a: 250,
      },
      {
        secteur: "agro_industrie",
        taille: "pme",
        gain: 4.2,
        source: "Retour d'expérience, mission Sahel Coton",
        il_y_a: 95,
      },
    ],
  },
  {
    code: "controle-de-gestion-couts",
    titre: "Installer un contrôle de gestion des coûts de revient",
    description:
      "Calculer les coûts de revient par produit, suivre les marges mensuellement et lancer un plan d'achats ciblé.",
    dimensions: ["couts", "pilotage"],
    effort: 4,
    duree_mois: 8,
    auteur: "consultant",
    impacts: [
      {
        secteur: "industrie",
        taille: "eti",
        gain: 9.0,
        source: "Suivi à douze mois, mission Redressement Brasseries du Wouri",
        il_y_a: 70,
      },
      {
        secteur: "agro_industrie",
        taille: "eti",
        gain: 7.6,
        source: "Suivi à neuf mois, mission Redressement Gabon Offshore",
        il_y_a: 15,
      },
    ],
  },
  {
    code: "demarche-innovation-ouverte",
    titre: "Lancer une démarche d'innovation ouverte avec les partenaires",
    description:
      "Organiser des ateliers avec clients et fournisseurs pour faire émerger des offres nouvelles. Initiative retirée : trop coûteuse pour les PME.",
    dimensions: ["innovation"],
    effort: 5,
    duree_mois: 12,
    retiree: true,
    auteur: "chef.mission",
    impacts: [
      {
        secteur: "numerique",
        taille: "pme",
        gain: 3.0,
        source: "Essai pilote dans une PME du numérique, 2025",
        il_y_a: 300,
      },
    ],
  },
  {
    code: "charte-delegations",
    titre: "Rédiger une charte de délégations de pouvoir",
    description:
      "Écrire qui décide quoi et jusqu'à quel montant, puis l'afficher et la faire signer par les responsables concernés.",
    dimensions: ["organisation"],
    effort: 1,
    duree_mois: 2,
    auteur: "consultant.2",
    impacts: [
      {
        secteur: "services",
        taille: "pme",
        gain: 3.2,
        source: "Suivi à trois mois, mission d'organisation 2025",
        il_y_a: 260,
      },
      {
        secteur: null,
        taille: "pme",
        gain: 3.6,
        source: "Moyenne des missions d'organisation 2025-2026",
        il_y_a: 50,
      },
    ],
  },
];

/* ----- Sessions de calibrage ----- */

export interface DefCalibrage {
  titre: string;
  cas: { code: string; libelle: string }[];
  niveaux: number;
  tolerance: number;
  /** Niveau « de référence » de chaque cas : les évaluateurs s'en écartent d'au plus un niveau. */
  reference: number[];
  evaluateurs: CleCompteCabinet[];
  /** Absent : la session reste ouverte (double cotation à l'aveugle en cours). */
  conclusion?: string;
}

export const CALIBRAGES: readonly DefCalibrage[] = [
  {
    titre: "Calibrage du quatrième trimestre 2025 — pilotage et organisation",
    cas: [
      {
        code: "cas-01",
        libelle: "PME agro-industrielle de 120 salariés : tableau de bord mensuel mais sans cibles",
      },
      {
        code: "cas-02",
        libelle: "Société de services de 45 salariés : délégations écrites, rarement appliquées",
      },
      {
        code: "cas-03",
        libelle:
          "Groupe industriel de 600 salariés : tableau de bord complet, données non vérifiées",
      },
      {
        code: "cas-04",
        libelle: "Enseigne de distribution de 80 salariés : aucun indicateur suivi hors ventes",
      },
      {
        code: "cas-05",
        libelle: "Banque de détail régionale : pilotage structuré, revues trimestrielles tracées",
      },
      {
        code: "cas-06",
        libelle: "Entreprise familiale de transport : décisions centralisées chez le fondateur",
      },
    ],
    niveaux: 5,
    tolerance: 1,
    reference: [3, 3, 3, 2, 5, 1],
    evaluateurs: ["expert.metier", "expert.metier.2", "chef.mission", "consultant"],
    conclusion:
      "Accord satisfaisant sur les cas extrêmes. Les cas 01 et 03 (indicateurs présents mais peu fiables) divergent d'un niveau : on retient le niveau 3 tant que les cibles ou la vérification des données manquent. Fiche d'ancrage de la pratique « fiabilité des données » à compléter.",
  },
  {
    titre: "Calibrage du troisième trimestre 2026 — engagement et climat social",
    cas: [
      {
        code: "cas-01",
        libelle: "Usine de 300 salariés : enquête de climat annuelle, plan d'action suivi",
      },
      {
        code: "cas-02",
        libelle: "Cabinet comptable de 25 personnes : écoute informelle uniquement",
      },
      {
        code: "cas-03",
        libelle: "Société de logistique : turnover élevé, aucune mesure des départs",
      },
      {
        code: "cas-04",
        libelle: "Établissement financier : baromètre semestriel, restitution aux équipes",
      },
      {
        code: "cas-05",
        libelle: "PME de négoce : reconnaissance par primes, sans critères connus",
      },
    ],
    niveaux: 5,
    tolerance: 1,
    reference: [4, 2, 1, 4, 2],
    evaluateurs: ["expert.metier", "consultant.2"],
  },
];
