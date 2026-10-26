import type { Auteur, ClePreuve } from "./dd-mboa-donnees.js";

/*
 * Données de la mission 4 (Mboa Solaire), suite : hypothèses et verdicts, dimensionnement de
 * marché, filtrage environnemental et social, plan des 100 jours. Les clés `h1` à `h6` désignent
 * les assertions « Mboa Solaire : … » semées par le registre des preuves ; `pt:<analyse>.<catégorie>`
 * une affirmation d'un point d'analyse du dossier. Les chiffres du dimensionnement sont des
 * ENTRÉES (bornes et sources) : tous les résultats sortent du moteur via la route.
 */

export type ValideurDd = "expert" | "expert2" | "directeur";

export interface DefLienHypothese {
  /** `h1`…`h6` (registre) ou `pt:<analyse>.<catégorie>` (point d'analyse du dossier). */
  assertion: string;
  sens: "soutient" | "contredit";
}

export interface DefHypothese {
  cle: string;
  libelle: string;
  description: string;
  critere: string;
  liens: DefLienHypothese[];
  /** Jour de création de l'hypothèse. */
  j: number;
  /** Jour des liens (après la création de toutes les assertions liées). */
  jLiens: number;
  correction?: { j: number; motif: string; libelle: string };
  /** Jour de la proposition de verdict ; un éventuel rejet précède la seconde proposition. */
  jVerdict: number;
  rejet?: { j: number; par: ValideurDd; motif: string; jNouveau: number };
  valideur: ValideurDd;
  jValidation: number;
  /** Verdict choisi quand il diffère de l'indication du moteur (motif d'au moins 20 caractères). */
  ecart?: { verdict: "confirmee" | "infirmee" | "non_concluante"; motif: string };
  motifVerdict: string;
  par: Auteur;
}

export const HYPOTHESES: DefHypothese[] = [
  {
    cle: "carnet",
    libelle: "Le carnet de commandes sécurise l'essentiel du chiffre d'affaires 2026",
    description: "Le plan d'affaires prévoit 24,3 milliards XOF de chiffre d'affaires en 2026.",
    critere: "Au moins 50 % du chiffre d'affaires prévu est couvert par des contrats signés.",
    liens: [
      { assertion: "h1", sens: "soutient" },
      { assertion: "h6", sens: "soutient" },
    ],
    j: 48,
    jLiens: 73,
    jVerdict: 80,
    valideur: "expert",
    jValidation: 82,
    motifVerdict:
      "Quatorze contrats signés couvrent 60 % du chiffre d’affaires 2026 prévu, mais le soutien reste étayé et non solide : la conversion du carnet en facturation n’est pas démontrée. Verdict non concluant.",
    par: "consultant",
  },
  {
    cle: "maintenance",
    libelle: "Le coût de maintenance du plan d'affaires (7 500 XOF/kWc) est réaliste",
    description: "Le plan retient 7 500 XOF par kWc et par an, pièces comprises.",
    critere: "Le coût réel observé est inférieur ou égal au coût retenu au plan.",
    liens: [
      { assertion: "h2", sens: "contredit" },
      { assertion: "pt:swot.faiblesses", sens: "contredit" },
    ],
    j: 49,
    jLiens: 74,
    jVerdict: 81,
    valideur: "expert2",
    jValidation: 84,
    motifVerdict:
      "La médiane régionale (9 800 XOF) et les contrats clients (8 200 XOF facturés) contredisent le coût du plan ; le modèle financier retient 9 000 XOF/kWc.",
    par: "consultant",
  },
  {
    cle: "tarif",
    libelle: "Le tarif de vente de 112 XOF/kWh est tenable sur l'ensemble du portefeuille",
    description: "Le plan applique 112 XOF/kWh à tous les clients.",
    critere: "Le tarif de 112 XOF/kWh est payé par une majorité de clients du portefeuille.",
    liens: [{ assertion: "h3", sens: "contredit" }],
    j: 50,
    jLiens: 75,
    correction: {
      j: 62,
      motif: "Précision du libellé après l'arbitrage du registre des preuves.",
      libelle:
        "Le tarif de vente de 112 XOF/kWh est tenable sur l'ensemble du portefeuille clients",
    },
    jVerdict: 83,
    valideur: "directeur",
    jValidation: 86,
    motifVerdict:
      "Le tarif dépasse de 14 % le tarif de référence et n'est payé que par quatre clients sur neuf, dans le cadre de contrats négociés.",
    par: "consultant2",
  },
  {
    cle: "performance",
    libelle: "Les installations respectent la garantie de performance de 92 %",
    description:
      "Les clients bénéficient d'une garantie de 92 % du productible théorique, assortie de pénalités.",
    critere:
      "La production mesurée atteint au moins 92 % du productible théorique sur les sites visités.",
    liens: [
      { assertion: "h4", sens: "contredit" },
      { assertion: "pt:pestel.technologique", sens: "contredit" },
    ],
    j: 51,
    jLiens: 76,
    jVerdict: 85,
    valideur: "expert",
    jValidation: 88,
    motifVerdict:
      "La production mesurée est de 87 % du productible théorique sur trois sites, en deçà de la garantie ; la cause identifiée est l'entretien des panneaux.",
    par: "consultant2",
  },
  {
    cle: "clients",
    libelle: "La relation client permet de renouveler les contrats de maintenance",
    description:
      "Le plan suppose le renouvellement des contrats de maintenance arrivant à échéance.",
    critere: "Une large majorité des clients interrogés renouvellerait son contrat.",
    liens: [
      { assertion: "h5", sens: "soutient" },
      { assertion: "pt:pestel.social", sens: "soutient" },
    ],
    j: 52,
    jLiens: 77,
    jVerdict: 86,
    rejet: {
      j: 88,
      par: "expert2",
      motif:
        "Le verdict s'appuie sur neuf réponses seulement ; la portée de l'enquête doit être précisée dans le motif avant validation.",
      jNouveau: 91,
    },
    valideur: "expert2",
    jValidation: 93,
    motifVerdict:
      "Sept clients sur neuf renouvelleraient leur contrat ; l'échantillon est limité (neuf réponses sur douze clients sollicités) et trois clients signalent des retards d'intervention.",
    par: "consultant",
  },
];

export interface DefParametre {
  code: string;
  bas: number;
  base: number;
  haut: number;
  source: { preuve: ClePreuve } | { avis: string };
}

export interface DefDimensionnement {
  methode: "ascendant" | "descendant";
  libelle: string;
  parametres: DefParametre[];
  ajustements: { libelle: string; facteur_bp: number; motif: string }[];
  j: number;
  par: Auteur;
  /** Version suivante : mêmes paramètres, avec ajustement tracé. */
  revision?: {
    j: number;
    par: Auteur;
    motif: string;
    libelle: string;
    ajustements: { libelle: string; facteur_bp: number; motif: string }[];
  };
}

const AVIS =
  "Estimation de l'équipe à partir des entretiens de marché et des références régionales.";

export const DIMENSIONNEMENTS: DefDimensionnement[] = [
  {
    methode: "ascendant",
    libelle: "Marché additionnel accessible à Mboa en 2026-2027 — méthode ascendante",
    parametres: [
      { code: "clients_cibles", bas: 2400, base: 3000, haut: 3600, source: { avis: AVIS } },
      { code: "taux_conquete", bas: 110, base: 150, haut: 190, source: { avis: AVIS } },
      { code: "volume_par_client", bas: 180, base: 220, haut: 260, source: { preuve: "p7" } },
      { code: "prix_unitaire", bas: 400000, base: 450000, haut: 500000, source: { preuve: "p2" } },
    ],
    ajustements: [],
    j: 56,
    par: "consultant",
    revision: {
      j: 87,
      par: "consultant2",
      motif: "Prise en compte d'une conversion partielle du carnet de commandes.",
      libelle: "Marché additionnel accessible à Mboa en 2026-2027 — méthode ascendante (prudente)",
      ajustements: [
        {
          libelle: "Conversion partielle du carnet de commandes",
          facteur_bp: 9000,
          motif: "Seuls 85 % du carnet sont supposés convertis en facturation sur 2026.",
        },
      ],
    },
  },
  {
    methode: "descendant",
    libelle: "Marché additionnel accessible à Mboa en 2026-2027 — méthode descendante",
    parametres: [
      {
        code: "marche_total",
        bas: 70_000_000_000,
        base: 90_000_000_000,
        haut: 110_000_000_000,
        source: { preuve: "p4" },
      },
      { code: "part_segment", bas: 3000, base: 3500, haut: 4000, source: { avis: AVIS } },
      { code: "part_adressable", bas: 4500, base: 5000, haut: 5500, source: { avis: AVIS } },
      { code: "part_capturable", bas: 2400, base: 2800, haut: 3200, source: { avis: AVIS } },
    ],
    ajustements: [],
    j: 63,
    par: "consultant2",
  },
];

export const ACTIVITES_MBOA = [
  "Installation de centrales solaires photovoltaïques en toiture pour des clients commerciaux",
  "Maintenance préventive et corrective d'installations solaires",
  "Vente d'électricité solaire dans le cadre de contrats négociés",
];
export const ACTIVITE_DIESEL =
  "Fourniture à titre accessoire de groupes électrogènes diesel de secours chez certains clients";

export const THEMES_FILTRAGE_1 = [
  {
    code: "evaluation_gestion",
    niveau: "modere",
    justification: "Politique de gestion des risques environnementaux et sociaux à formaliser.",
  },
  { code: "main_oeuvre", niveau: "faible", justification: null },
  { code: "biodiversite", niveau: "non_concerne", justification: null },
] as const;

export const THEMES_FILTRAGE_2 = [
  {
    code: "evaluation_gestion",
    niveau: "modere",
    justification:
      "Politique de gestion des risques environnementaux et sociaux à formaliser après l'acquisition.",
  },
  { code: "main_oeuvre", niveau: "faible", justification: null },
  {
    code: "ressources_pollution",
    niveau: "modere",
    justification: "Filière de reprise des panneaux et des batteries en fin de vie non documentée.",
  },
  { code: "sante_securite_communautes", niveau: "faible", justification: null },
  { code: "terres_reinstallation", niveau: "non_concerne", justification: null },
  { code: "biodiversite", niveau: "non_concerne", justification: null },
  { code: "peuples_autochtones", niveau: "non_concerne", justification: null },
  { code: "patrimoine_culturel", niveau: "non_concerne", justification: null },
] as const;

/** Étape de suivi d'une action du plan des 100 jours (nouvelle version de l'action). */
export interface SuiviAction {
  /** Jours après le début de la mission. */
  j: number;
  statut: "en_cours" | "terminee";
  motif: string;
}

export interface DefAction {
  libelle: string;
  description: string;
  jour_debut: number;
  jour_fin: number;
  responsable?: Auteur;
  /** Jour de création de l'action (jours après le début de la mission). */
  j: number;
  /** Suivi jusqu'à la fin : toutes les actions sont TERMINÉES (mission terminée). */
  suivi: SuiviAction[];
}

/**
 * Plan des 100 jours de la mission terminée : la date de l'opération est le 15 septembre 2025
 * (cadrage), donc les actions (jours 0 à 90) s'achèvent au plus tard le 14 décembre, avant la fin
 * de la mission (19 décembre). Création mi-septembre, suivi par les routes de versions.
 */
export const ACTIONS: DefAction[] = [
  {
    libelle: "Formaliser la délégation de la direction technique",
    description: "Nommer un adjoint au directeur technique et documenter les délégations.",
    jour_debut: 0,
    jour_fin: 30,
    responsable: "consultant",
    j: 14,
    suivi: [
      { j: 20, statut: "en_cours", motif: "Entretiens avec la direction technique engagés." },
      { j: 44, statut: "terminee", motif: "Adjoint nommé et délégations signées par le vendeur." },
    ],
  },
  {
    libelle: "Mettre en place un programme de nettoyage préventif des panneaux",
    description: "Calendrier de nettoyage par site et suivi des écarts de production.",
    jour_debut: 10,
    jour_fin: 60,
    responsable: "consultant2",
    j: 15,
    suivi: [
      { j: 30, statut: "en_cours", motif: "Calendrier par site en cours de validation." },
      { j: 72, statut: "terminee", motif: "Programme déployé sur les douze sites." },
    ],
  },
  {
    libelle: "Réviser le coût de maintenance dans le modèle financier",
    description: "Retenir 9 000 XOF/kWc et par an et mesurer l'effet sur la marge.",
    jour_debut: 0,
    jour_fin: 20,
    responsable: "consultant",
    j: 16,
    suivi: [
      {
        j: 19,
        statut: "en_cours",
        motif: "Travail engagé avec le directeur financier du vendeur.",
      },
      {
        j: 40,
        statut: "terminee",
        motif: "Modèle financier révisé et effet sur la marge chiffré.",
      },
    ],
  },
  {
    libelle: "Renégocier les contrats à tarif de 112 XOF/kWh non justifié",
    description: "Examiner les contrats hors accord négocié et proposer une grille de prix.",
    jour_debut: 30,
    jour_fin: 90,
    j: 17,
    suivi: [
      { j: 55, statut: "en_cours", motif: "Revue des contrats hors accord négocié." },
      { j: 104, statut: "terminee", motif: "Grille de prix proposée aux clients concernés." },
    ],
  },
  {
    libelle: "Documenter la couverture des achats en devises",
    description: "Recenser les achats hors zone franc et définir une politique de couverture.",
    jour_debut: 20,
    jour_fin: 70,
    j: 18,
    suivi: [
      { j: 40, statut: "en_cours", motif: "Recensement des achats hors zone franc." },
      {
        j: 85,
        statut: "terminee",
        motif: "Politique de couverture adoptée par le comité d'achats.",
      },
    ],
  },
];
