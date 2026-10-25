import type { CleCollaborateur, CleCompte } from "../cles.js";

/*
 * Offres techniques et financières de la banque d'AO (appels d'offres de `donnees-ao-liste.ts`,
 * retrouvés par `cle`). Textes en français, organismes fictifs. Les montants des offres financières
 * NE SONT PAS ici : seuls les jours et les taux journaliers (XOF/jour, 45 000 à 600 000) sont
 * saisis ; le moteur `offre-financiere` calcule les totaux.
 */

export interface OffreTechniqueDemo {
  cle: string;
  titre: string;
  createur: CleCompte;
  experts: CleCollaborateur[];
  contexte: {
    client: string;
    pays: string;
    secteur: string;
    bailleur: string;
    objectifs: string;
    termes_reference: string;
  };
  /** Version humaine (v2) : remplace les repères du gabarit. */
  edition: { auteur: CleCompte; motif: string; comprehension: string; methodologie: string };
  /** Valideur de la dernière version : jamais le créateur, l'auteur d'une version ni le demandeur IA. */
  valideur: CleCompte | null;
}

export const OFFRES_TECHNIQUES_DEMO: readonly OffreTechniqueDemo[] = [
  {
    cle: "sicafe-plan",
    titre: "Offre technique — plan stratégique 2025-2028 d'un groupe agro-industriel",
    createur: "chef.mission",
    experts: ["associe", "directeur.mission", "consultant"],
    contexte: {
      client: "Groupe SICAFE",
      pays: "CI",
      secteur: "Agro-industrie",
      bailleur: "Groupe SICAFE",
      objectifs:
        "Doter le groupe d'une vision partagée et d'un plan d'action 2025-2028 décliné dans les deux filiales.",
      termes_reference:
        "Le groupe souhaite être accompagné dans la définition de sa vision, de ses objectifs stratégiques et de leur cascade en objectifs de filiale, avec un tableau de bord de pilotage et des ateliers de direction.",
    },
    edition: {
      auteur: "consultant",
      motif: "Rédaction de la compréhension et de la méthodologie à partir des termes de référence",
      comprehension:
        "Le groupe SICAFE, holding et deux filiales, doit arrêter un cap commun pour 2025-2028 dans un contexte de volatilité des cours et de montée des exigences de traçabilité. Il attend une vision partagée par la direction générale, une cascade d'objectifs lisible jusqu'aux filiales et un tableau de bord permettant de piloter la mise en œuvre.",
      methodologie:
        "Notre démarche suit quatre temps : cadrage et diagnostic stratégique (entretiens, revue documentaire), construction de la vision lors de deux ateliers de direction, cascade des objectifs en indicateurs par filiale, puis plan d'action et tableau de bord. Chaque livrable est validé en comité de pilotage avant l'étape suivante.",
    },
    valideur: "directeur.mission.2",
  },
  {
    cle: "mboa-dd",
    titre: "Offre technique — due diligence d'un opérateur solaire",
    createur: "consultant.2",
    experts: ["associe.2", "chef.mission.2", "consultant"],
    contexte: {
      client: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
      pays: "CM",
      secteur: "Énergie",
      bailleur: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
      objectifs:
        "Éclairer la décision d'entrée au capital d'un opérateur solaire par une revue financière, opérationnelle et contractuelle.",
      termes_reference:
        "Le fonds sollicite une revue de due diligence de l'opérateur : qualité des états financiers, portefeuille de contrats, performance des installations et risques identifiés avant l'entrée au capital.",
    },
    edition: {
      auteur: "chef.mission.2",
      motif:
        "Rédaction de la compréhension et de la méthodologie, relecture des points de contrôle",
      comprehension:
        "Le fonds envisage une prise de participation dans un opérateur camerounais de solutions solaires. Il attend une opinion étayée sur la fiabilité des comptes, la solidité des contrats clients et l'état du parc installé, afin de fixer le prix et les garanties de l'opération.",
      methodologie:
        "La revue se déroule en trois volets menés en parallèle : financier (états financiers, trésorerie, dette), opérationnel (visite d'un échantillon de sites, maintenance) et contractuel (contrats clients et fournisseurs). Les constats sont classés par niveau de risque et restitués dans un rapport assorti de recommandations de garanties.",
    },
    valideur: "directeur.mission",
  },
  {
    cle: "baobab-plan",
    titre: "Offre technique — plan stratégique 2026-2030 d'une compagnie d'assurances",
    createur: "chef.mission.2",
    experts: ["associe.2", "directeur.mission", "consultant.2"],
    contexte: {
      client: "Baobab Assurances",
      pays: "SN",
      secteur: "Assurance",
      bailleur: "Baobab Assurances",
      objectifs:
        "Élaborer le plan stratégique 2026-2030, le modèle financier et le tableau de bord de pilotage de la compagnie.",
      termes_reference:
        "La compagnie, présente dans plusieurs pays de la zone UEMOA, demande un plan stratégique 2026-2030 adossé à un modèle financier et à un tableau de bord de pilotage suivi par la direction générale.",
    },
    edition: {
      auteur: "consultant.2",
      motif: "Rédaction de la compréhension et de la méthodologie, ajout du volet modèle financier",
      comprehension:
        "Baobab Assurances prépare son prochain cycle stratégique dans un marché marqué par la pression sur les marges techniques et l'arrivée de nouveaux acteurs. La direction attend un plan 2026-2030 chiffré, cohérent avec ses ratios de solvabilité, et un outil de pilotage utilisable par chaque pays.",
      methodologie:
        "Après un diagnostic de la position concurrentielle et des performances par branche, nous construisons trois scénarios stratégiques testés dans un modèle financier, puis le plan d'action et ses indicateurs. Le modèle est transmis à la direction financière avec une formation à son utilisation.",
    },
    valideur: "directeur.mission",
  },
  {
    cle: "gouvernance-publique",
    titre: "Offre technique — diagnostic de la gestion des investissements publics",
    createur: "consultant",
    experts: ["associe", "chef.mission", "consultant.2"],
    contexte: {
      client: "Direction Générale du Budget et des Finances Publiques",
      pays: "GA",
      secteur: "Secteur public",
      bailleur: "Direction Générale du Budget et des Finances Publiques",
      objectifs:
        "Diagnostiquer la fonction de programmation des investissements d'un ministère et proposer un plan de renforcement.",
      termes_reference:
        "Le ministère demande un diagnostic organisationnel de sa fonction de programmation des investissements publics, suivi d'un plan de renforcement des capacités sur douze mois.",
    },
    edition: {
      auteur: "chef.mission",
      motif:
        "Rédaction de la compréhension et de la méthodologie ; adaptation aux exigences du secteur public",
      comprehension:
        "Le ministère constate des retards récurrents dans la programmation et le suivi de ses projets d'investissement. Il souhaite comprendre les causes organisationnelles de ces retards et disposer d'un plan réaliste pour renforcer ses équipes et ses procédures.",
      methodologie:
        "Nous procédons par entretiens avec les directions concernées, revue d'un échantillon de dossiers d'investissement et cartographie des processus de programmation. Le diagnostic débouche sur un plan de renforcement chiffré en jours et priorisé selon l'effet attendu sur les délais.",
    },
    valideur: "directeur.mission.2",
  },
  {
    cle: "cemac-formation",
    titre: "Offre technique — programme de renforcement des capacités des PME exportatrices",
    createur: "chef.mission",
    experts: ["directeur.mission", "consultant.2", "consultant"],
    contexte: {
      client: "Programme Régional d'Appui à l'Export (CEMAC)",
      pays: "CM",
      secteur: "Appui aux PME",
      bailleur: "Programme Régional d'Appui à l'Export (CEMAC)",
      objectifs:
        "Accompagner quarante PME exportatrices de la zone CEMAC par des diagnostics flash, des formations et un suivi.",
      termes_reference:
        "Le programme recherche un prestataire pour concevoir et animer un parcours d'accompagnement de quarante PME exportatrices : diagnostic flash, formations collectives et suivi individuel à six mois.",
    },
    edition: {
      auteur: "consultant.2",
      motif:
        "Première rédaction de la compréhension et de la méthodologie, à relire avant validation",
      comprehension:
        "Le programme vise à augmenter les exportations de quarante PME de la zone CEMAC. Les termes de référence insistent sur des diagnostics rapides, des formations adaptées au niveau des entreprises et un suivi mesurable à six mois.",
      methodologie:
        "Chaque PME bénéficie d'un diagnostic flash de deux jours, d'un parcours de formation collective par thème (financement, conformité, logistique) et d'un suivi individuel à trois et six mois. Un tableau de suivi permet au programme de mesurer les progrès par entreprise.",
    },
    valideur: null,
  },
];

export interface LigneHonoraireDemo {
  expert: CleCollaborateur;
  libelle: string;
  jours: number;
  taux: number;
}

export interface OffreFinanciereDemo {
  cle: string;
  titre: string;
  createur: CleCompte;
  devise: "XOF" | "XAF";
  honoraires: LigneHonoraireDemo[];
  per_diem: { libelle: string; quantite: number; prix_unitaire: number }[];
  debours: { libelle: string; quantite: number; prix_unitaire: number }[];
  tva: number;
  /** Version 2 : jours révisés (facteur appliqué aux jours), motif et auteur. */
  revision?: { auteur: CleCompte; motif: string; facteurJours: number };
}

/** Taux de vente (XOF/jour) par profil, cohérents avec les grades du cabinet. */
const ASSOCIE = 600_000;
const DIRECTEUR = 420_000;
const MANAGER = 290_000;
const SENIOR = 190_000;

export const OFFRES_FINANCIERES_DEMO: readonly OffreFinanciereDemo[] = [
  {
    cle: "sicafe-plan",
    titre: "Offre financière — plan stratégique 2025-2028 d'un groupe agro-industriel",
    createur: "associe",
    devise: "XOF",
    honoraires: [
      {
        expert: "associe",
        libelle: "Associée — cadrage et ateliers de direction",
        jours: 14,
        taux: ASSOCIE,
      },
      { expert: "directeur.mission", libelle: "Directeur de mission", jours: 38, taux: DIRECTEUR },
      { expert: "chef.mission", libelle: "Cheffe de mission", jours: 52, taux: MANAGER },
      { expert: "consultant", libelle: "Consultant senior", jours: 60, taux: SENIOR },
    ],
    per_diem: [
      { libelle: "Missions de terrain dans les filiales", quantite: 24, prix_unitaire: 75_000 },
    ],
    debours: [
      {
        libelle: "Déplacements et hébergement (Yamoussoukro, San-Pédro)",
        quantite: 1,
        prix_unitaire: 2_400_000,
      },
    ],
    tva: 18,
    revision: {
      auteur: "gestionnaire",
      motif: "Jours révisés après la clarification sur les deux ateliers",
      facteurJours: 1.05,
    },
  },
  {
    cle: "mboa-dd",
    titre: "Offre financière — due diligence d'un opérateur solaire",
    createur: "associe",
    devise: "XAF",
    honoraires: [
      { expert: "associe.2", libelle: "Associé — revue et opinion", jours: 12, taux: ASSOCIE },
      { expert: "chef.mission.2", libelle: "Chef de mission", jours: 40, taux: MANAGER },
      {
        expert: "consultant",
        libelle: "Consultant senior — modèle financier",
        jours: 45,
        taux: 210_000,
      },
    ],
    per_diem: [
      { libelle: "Visites de sites (Douala, Garoua)", quantite: 18, prix_unitaire: 70_000 },
    ],
    debours: [
      {
        libelle: "Billets d'avion et locations de véhicules",
        quantite: 1,
        prix_unitaire: 1_850_000,
      },
    ],
    tva: 19,
  },
  {
    cle: "baobab-plan",
    titre: "Offre financière — plan stratégique 2026-2030 d'une compagnie d'assurances",
    createur: "gestionnaire",
    devise: "XOF",
    honoraires: [
      { expert: "associe.2", libelle: "Associé — pilotage stratégique", jours: 16, taux: ASSOCIE },
      { expert: "directeur.mission", libelle: "Directeur de mission", jours: 44, taux: DIRECTEUR },
      {
        expert: "consultant.2",
        libelle: "Consultante senior — branches et risques",
        jours: 58,
        taux: SENIOR,
      },
      {
        expert: "consultant",
        libelle: "Consultant senior — modèle financier",
        jours: 62,
        taux: 210_000,
      },
    ],
    per_diem: [{ libelle: "Séjours à Dakar et Abidjan", quantite: 30, prix_unitaire: 80_000 }],
    debours: [{ libelle: "Voyages et ateliers pays", quantite: 1, prix_unitaire: 3_100_000 }],
    tva: 18,
    revision: {
      auteur: "associe",
      motif: "Ajout de jours pour la formation à l'utilisation du modèle",
      facteurJours: 1.04,
    },
  },
  {
    cle: "gouvernance-publique",
    titre: "Offre financière — diagnostic de la gestion des investissements publics",
    createur: "gestionnaire",
    devise: "XAF",
    honoraires: [
      { expert: "associe", libelle: "Associée — supervision", jours: 10, taux: ASSOCIE },
      { expert: "chef.mission", libelle: "Cheffe de mission", jours: 55, taux: MANAGER },
      { expert: "consultant.2", libelle: "Consultante senior", jours: 60, taux: SENIOR },
    ],
    per_diem: [{ libelle: "Séjour à Libreville", quantite: 40, prix_unitaire: 65_000 }],
    debours: [{ libelle: "Voyages internationaux", quantite: 1, prix_unitaire: 2_200_000 }],
    tva: 18,
  },
  {
    cle: "cemac-formation",
    titre: "Offre financière — programme de renforcement des capacités des PME exportatrices",
    createur: "associe.2",
    devise: "XAF",
    honoraires: [
      { expert: "directeur.mission", libelle: "Directeur de mission", jours: 30, taux: DIRECTEUR },
      {
        expert: "consultant.2",
        libelle: "Consultante senior — formations",
        jours: 90,
        taux: SENIOR,
      },
      {
        expert: "consultant",
        libelle: "Consultant senior — diagnostics flash",
        jours: 80,
        taux: 210_000,
      },
    ],
    per_diem: [
      { libelle: "Déplacements dans les pays de la zone", quantite: 60, prix_unitaire: 70_000 },
    ],
    debours: [
      {
        libelle: "Location de salles et supports de formation",
        quantite: 1,
        prix_unitaire: 4_200_000,
      },
    ],
    tva: 19,
  },
];
