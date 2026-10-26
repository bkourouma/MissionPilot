import { axe, initiative, objectif, vision } from "./plans-coeur-outils.js";
import type { SpecElement } from "./plans-coeur-types.js";

/*
 * Plan 1 — « Plan stratégique 2025-2028 — SICAFE » (agro-industrie café-cacao, Côte d'Ivoire).
 * Éléments : diagnostic, SWOT, vision, 4 axes, 8 objectifs (7 liés à des KPI existants de la
 * mission, 1 KPI créé par la route), 11 initiatives dont 5 de la bibliothèque d'initiatives types.
 * Les statuts d'initiative sont ceux de la date du jeu de données (2026-10-24).
 */

export const ELEMENTS_SICAFE: readonly SpecElement[] = [
  {
    cle: "diagnostic",
    type: "diagnostic",
    auteur: "consultant",
    creation: {
      synthese:
        "SICAFÉ transforme et exporte du café et du cacao ivoiriens. Le chiffre d'affaires 2024 atteint 9,6 milliards de FCFA pour une marge brute de 31 %, inférieure de trois à quatre points à celle des acteurs comparables. Trois causes ressortent : un approvisionnement dispersé auprès de plus de 150 coopératives sans contrat de volume, un taux de défaut qualité de 3,4 % qui coûte des lots entiers à l'export, et un délai de recouvrement de 63 jours qui immobilise la trésorerie. L'outil de séchage de Daloa sature chaque campagne.",
    },
    etapes: [
      {
        maj: {
          synthese:
            "SICAFÉ transforme et exporte du café et du cacao ivoiriens. Le chiffre d'affaires 2024 atteint 9,6 milliards de FCFA pour une marge brute de 31 %, inférieure de trois à quatre points à celle des acteurs comparables. Trois causes ressortent : un approvisionnement dispersé auprès de plus de 150 coopératives sans contrat de volume, un taux de défaut qualité de 3,4 % qui coûte des lots entiers à l'export, et un délai de recouvrement de 63 jours qui immobilise la trésorerie. L'outil de séchage de Daloa sature chaque campagne. Les entretiens de direction (12) et la revue des 24 derniers mois de données confirment que la dépendance à deux acheteurs européens (58 % des ventes à l'export) est le principal risque commercial.",
        },
      },
      { valider: "directeur" },
    ],
  },
  {
    cle: "swot",
    type: "swot",
    auteur: "consultant",
    creation: {
      forces: [
        "Marque reconnue des torréfacteurs européens et relation de long terme avec les coopératives",
        "Outil industriel de séchage et de tri déjà amorti sur 60 % de sa valeur",
        "Équipe d'encadrement stable (ancienneté moyenne de 9 ans)",
      ],
      faiblesses: [
        "Marge brute inférieure à celle du secteur",
        "Taux de défaut qualité de 3,4 % et traçabilité lot par lot incomplète",
        "Recouvrement lent (63 jours) et suivi de trésorerie hebdomadaire manuel",
      ],
      opportunites: [
        "Demande européenne en cafés et cacaos certifiés, avec prime de 8 à 12 % au prix",
        "Règlement européen sur la déforestation : avantage aux filières tracées",
        "Appui des guichets de financement agricoles à l'équipement de séchage",
      ],
      menaces: [
        "Volatilité des cours mondiaux et du prix bord champ fixé par l'État",
        "Concentration des ventes sur deux acheteurs",
        "Aléas climatiques sur les récoltes principales",
      ],
    },
    etapes: [
      {
        maj: {
          opportunites: [
            "Demande européenne en cafés et cacaos certifiés, avec prime de 8 à 12 % au prix",
            "Règlement européen sur la déforestation : avantage aux filières tracées",
            "Appui des guichets de financement agricoles à l'équipement de séchage",
            "Ouverture des marchés du Benelux et d'Allemagne du Nord pour les petits lots premium",
          ],
        },
      },
      { valider: "directeur" },
    ],
  },
  vision(
    "Être d'ici 2028 le partenaire de référence des torréfacteurs européens pour des cafés et cacaos ivoiriens tracés et certifiés.",
    "Valoriser le travail de nos coopératives partenaires en livrant, campagne après campagne, une qualité constante et vérifiable.",
    ["Qualité constante", "Partenariat équitable avec les producteurs", "Rigueur de gestion"],
    { porteur: "directeur.mission" },
  ),
  axe(
    "A1",
    "Sécuriser et fiabiliser l'approvisionnement",
    "Contractualiser les volumes avec les coopératives, réduire le coût d'achat et la consommation d'énergie du séchage.",
    "chef.mission",
  ),
  axe(
    "A2",
    "Monter en gamme et améliorer la rentabilité",
    "Réduire les défauts qualité, tracer chaque lot et porter la marge brute à 35 % du chiffre d'affaires.",
    "consultant",
  ),
  axe(
    "A3",
    "Accélérer l'export et diversifier les marchés",
    "Réduire la dépendance aux deux acheteurs principaux, certifier les filières et ouvrir de nouveaux marchés.",
    "associe.2",
  ),
  axe(
    "A4",
    "Moderniser l'organisation et développer les talents",
    "Piloter par les chiffres, accélérer les encaissements et fidéliser les managers de production.",
    "consultant.2",
  ),
  objectif("O1", "A1", "Réduire de 6 % le coût d'approvisionnement d'ici 2028", {
    perspective: "finances",
    indicateur: "Coûts d'approvisionnement mensuels (kFCFA)",
    cible: "-6 % par rapport à 2024",
    cibleRevisee: "-6 % par rapport à 2024, à périmètre de volumes constant",
    echeance: "2028-12-31",
    description: "Contrats de volume pluriannuels et achats groupés d'emballages.",
    porteur: "chef.mission",
    kpi: ["Coûts d'approvisionnement"],
  }),
  objectif("O2", "A2", "Ramener le taux de défaut qualité sous 2,5 %", {
    perspective: "processus",
    indicateur: "Taux de défaut qualité (%)",
    cible: "< 2,5 % dès la campagne 2026-2027",
    echeance: "2027-06-30",
    description: "Tri optique, traçabilité lot par lot et contrôle à la réception.",
    porteur: "consultant",
    kpi: ["Taux de défaut qualité"],
  }),
  objectif("O3", "A2", "Porter la marge brute à 35 % du chiffre d'affaires", {
    perspective: "finances",
    indicateur: "Marge brute mensuelle (kFCFA)",
    cible: "35 % du chiffre d'affaires en 2028",
    cibleRevisee: "35 % du chiffre d'affaires en 2028 (34 % en 2027)",
    echeance: "2028-12-31",
    description: "Effet combiné de la qualité, du mix produits et du coût d'achat.",
    porteur: "directeur.mission",
    kpi: ["Marge brute mensuelle"],
  }),
  objectif("O4", "A3", "Atteindre 30 % du chiffre d'affaires à l'export vers de nouveaux marchés", {
    perspective: "finances",
    indicateur: "Chiffre d'affaires mensuel (kFCFA)",
    cible: "30 % du chiffre d'affaires réalisé hors des deux acheteurs principaux",
    echeance: "2028-12-31",
    description: "Certification, bureau commercial en Europe du Nord et petits lots premium.",
    porteur: "associe.2",
    kpi: ["Chiffre d'affaires mensuel"],
  }),
  objectif("O5", "A3", "Dépasser 60 points de satisfaction client", {
    perspective: "clients",
    indicateur: "Indice de satisfaction client (NPS)",
    cible: "> 60 points",
    echeance: "2027-12-31",
    description: "Respect des calendriers de livraison et réactivité sur les réclamations.",
    porteur: "associe.2",
    kpi: ["Indice de satisfaction client (NPS)"],
  }),
  objectif("O6", "A4", "Ramener le délai moyen de recouvrement à 45 jours", {
    perspective: "processus",
    indicateur: "Délai moyen de recouvrement (jours)",
    cible: "45 jours",
    echeance: "2026-12-31",
    description: "Relances structurées et suivi hebdomadaire des encours.",
    porteur: "consultant.2",
    kpi: ["Délai moyen de recouvrement"],
  }),
  objectif("O7", "A4", "Contenir la rotation du personnel sous 9 %", {
    perspective: "apprentissage",
    indicateur: "Taux de rotation du personnel (%)",
    cible: "< 9 % par an",
    echeance: "2027-12-31",
    description: "Formation des managers de production et parcours de carrière.",
    porteur: "consultant.2",
    kpi: ["Taux de rotation du personnel"],
  }),
  objectif("O8", "A1", "Réduire de 15 % l'énergie consommée par tonne séchée", {
    perspective: "processus",
    indicateur: "Énergie consommée par tonne séchée (kWh/t)",
    cible: "-15 % d'ici 2027",
    echeance: "2027-12-31",
    description: "Séchoirs à récupération de chaleur et valorisation des coques.",
    porteur: "chef.mission",
  }),
  initiative("I1", "Extension de la capacité de séchage à Daloa", {
    parent: "A1",
    description:
      "Construction de six séchoirs et d'un hangar de stockage pour absorber la campagne principale sans engorgement.",
    debut: "2025-05-05",
    echeance: "2025-12-19",
    budget: 1_200_000_000,
    gains: [0, 180_000_000, 360_000_000, 420_000_000],
    statut: "terminee",
    responsable: "chef.mission",
  }),
  initiative("I2", "Amélioration du recouvrement des créances clients", {
    parent: "O6",
    description: "",
    debut: "2025-06-02",
    echeance: "2025-08-30",
    budget: 0,
    gains: [45_000_000, 60_000_000, 60_000_000, 60_000_000],
    statut: "terminee",
    responsable: "consultant.2",
    bibliotheque: { code: "recouvrement_creances" },
  }),
  initiative("I3", "Programme de contractualisation avec 40 coopératives", {
    parent: "O1",
    description:
      "Contrats de volume sur trois campagnes, prime de qualité et préfinancement des intrants.",
    debut: "2025-07-01",
    echeance: "2026-06-30",
    budget: 380_000_000,
    gains: [60_000_000, 150_000_000, 190_000_000, 190_000_000],
    statut: "terminee",
    responsable: "chef.mission",
  }),
  initiative("I4", "Tableau de bord de pilotage hebdomadaire", {
    parent: "A4",
    description: "",
    debut: "2025-09-01",
    echeance: "2025-11-29",
    budget: 0,
    gains: [10_000_000, 25_000_000, 25_000_000, 25_000_000],
    statut: "terminee",
    responsable: "consultant",
    bibliotheque: { code: "tableau_de_bord_pilotage" },
  }),
  initiative("I5", "Digitalisation du contrôle qualité et de la traçabilité", {
    parent: "O2",
    description: "",
    debut: "2026-01-12",
    echeance: "2026-10-08",
    budget: 420_000_000,
    gains: [0, 90_000_000, 170_000_000, 190_000_000],
    statut: "en_cours",
    responsable: "consultant",
    bibliotheque: { code: "digitalisation_processus", budget: 420_000_000 },
  }),
  initiative("I6", "Chaîne de tri optique", {
    parent: "O2",
    description:
      "Acquisition et mise en service d'une trieuse optique pour le café vert et le cacao fèves.",
    debut: "2026-10-19",
    echeance: "2027-06-30",
    budget: 650_000_000,
    gains: [0, 0, 150_000_000, 240_000_000],
    statut: "a_lancer",
    responsable: "chef.mission",
    dependances: ["I5"],
  }),
  initiative("I7", "Certification Rainforest Alliance de 25 coopératives", {
    parent: "O4",
    description:
      "Audits préparatoires, formation des producteurs et prise en charge de la première certification.",
    debut: "2026-07-06",
    echeance: "2027-03-26",
    budget: 210_000_000,
    gains: [0, 40_000_000, 110_000_000, 130_000_000],
    statut: "en_cours",
    responsable: "associe.2",
    dependances: ["I3"],
  }),
  initiative("I8", "Bureau commercial à Rotterdam et premiers contrats", {
    parent: "O4",
    description:
      "Recrutement d'un responsable export, prospection des torréfacteurs du Benelux et premiers conteneurs de petits lots.",
    debut: "2026-03-02",
    echeance: "2027-03-31",
    budget: 340_000_000,
    gains: [0, 60_000_000, 190_000_000, 260_000_000],
    statut: "en_cours",
    responsable: "directeur.mission",
    dependances: ["I1"],
    precisionApresValidation: "Premier conteneur livré à Rotterdam en septembre 2026.",
  }),
  initiative("I9", "Programme de formation des managers de production", {
    parent: "O7",
    description: "",
    debut: "2025-11-03",
    echeance: "2026-03-02",
    budget: 0,
    gains: [8_000_000, 18_000_000, 18_000_000, 18_000_000],
    statut: "terminee",
    responsable: "consultant.2",
    bibliotheque: { code: "formation_managers" },
  }),
  initiative("I10", "Plan de réduction des coûts de transport et de manutention", {
    parent: "O1",
    description: "",
    debut: "2026-04-06",
    echeance: "2026-09-02",
    budget: 0,
    gains: [15_000_000, 55_000_000, 55_000_000, 55_000_000],
    statut: "en_cours",
    responsable: "chef.mission",
    bibliotheque: { code: "reduction_couts" },
  }),
  initiative("I11", "Étude de faisabilité d'une ligne de transformation (poudre de cacao)", {
    parent: "A2",
    description:
      "Étude de marché, dimensionnement industriel et plan de financement d'une première ligne de transformation locale.",
    debut: "2027-07-05",
    echeance: "2028-03-31",
    budget: 180_000_000,
    gains: [0, 0, 0, 120_000_000],
    statut: "a_lancer",
    responsable: "associe.2",
    dependances: ["I6"],
  }),
];
