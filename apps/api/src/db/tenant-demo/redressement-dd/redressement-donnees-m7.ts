import { M } from "./redressement-outils.js";

/*
 * Données du dossier « Redressement — Gabon Offshore Services » (mission 7, depuis le 6 juillet
 * 2026), prestataire de services maritimes et de maintenance pour l'offshore pétrolier. Dossier
 * OUVERT : états du client en tension, urgence élevée, créanciers en négociation (un seul accord
 * en cours d'exécution), plan en brouillon avec des actions en retard au 24 octobre 2026.
 * Montants en XOF ; les ratios, voyants, scores et leviers sont calculés par les moteurs.
 */

type Ligne = {
  code: string;
  libelle: string;
  section: string;
  montant: number;
  role?: string;
};

const l = (code: string, libelle: string, section: string, m: number, role?: string): Ligne => ({
  code,
  libelle,
  section,
  montant: m * M,
  ...(role ? { role } : {}),
});

/** Exercice 2025 : chiffre d'affaires 9,6 Md, actif = passif = 6 Md, résultat net 96 M. */
export const ETAT_M7_2025: Ligne[] = [
  l("ST", "Stocks de pièces détachées", "actif", 300),
  l("CL", "Créances clients (opérateurs pétroliers)", "actif", 2_500),
  l("AC", "Autres créances", "actif", 360),
  l("TR", "Trésorerie", "actif", 60),
  l("IM", "Navires d'appui et immobilisations", "actif", 2_780),
  l("BZ", "Total actif", "actif", 6_000, "total"),
  l("CP", "Capital et réserves", "passif", 984),
  l("CJ", "Résultat de l'exercice", "passif", 96, "resultat_exercice"),
  l("DF", "Dettes financières", "passif", 1_000),
  l("DJ", "Fournisseurs et sous-traitants", "passif", 2_000),
  l("DX", "Dettes fiscales, sociales et autres", "passif", 1_500),
  l("PR", "Provisions", "passif", 420),
  l("BP", "Total passif", "passif", 6_000, "total"),
  l("RA", "Coût des prestations", "charges", 7_900),
  l("RB", "Autres charges d'exploitation", "charges", 1_480),
  l("RF", "Charges financières", "charges", 110),
  l("RI", "Impôts", "charges", 14),
  l("XB", "Chiffre d'affaires", "produits", 9_600),
  l("XI", "Résultat net", "resultat", 96, "resultat_net"),
];

/** Exercice 2024 : chiffre d'affaires 11,2 Md, actif = passif = 6,4 Md, résultat net 190 M. */
export const ETAT_M7_2024: Ligne[] = [
  l("ST", "Stocks de pièces détachées", "actif", 340),
  l("CL", "Créances clients (opérateurs pétroliers)", "actif", 2_700),
  l("AC", "Autres créances", "actif", 380),
  l("TR", "Trésorerie", "actif", 220),
  l("IM", "Navires d'appui et immobilisations", "actif", 2_760),
  l("BZ", "Total actif", "actif", 6_400, "total"),
  l("CP", "Capital et réserves", "passif", 910),
  l("CJ", "Résultat de l'exercice", "passif", 190, "resultat_exercice"),
  l("DF", "Dettes financières", "passif", 1_150),
  l("DJ", "Fournisseurs et sous-traitants", "passif", 1_900),
  l("DX", "Dettes fiscales, sociales et autres", "passif", 1_450),
  l("PR", "Provisions", "passif", 800),
  l("BP", "Total passif", "passif", 6_400, "total"),
  l("RA", "Coût des prestations", "charges", 9_200),
  l("RB", "Autres charges d'exploitation", "charges", 1_560),
  l("RF", "Charges financières", "charges", 120),
  l("RI", "Impôts", "charges", 130),
  l("XB", "Chiffre d'affaires", "produits", 11_200),
  l("XI", "Résultat net", "resultat", 190, "resultat_net"),
];

export const CORRESPONDANCE_M7 = {
  stocks: { codes: ["ST"], sans_objet: false },
  creances_clients: { codes: ["CL"], sans_objet: false },
  autres_creances: { codes: ["AC"], sans_objet: false },
  tresorerie_actif: { codes: ["TR"], sans_objet: false },
  capitaux_propres: { codes: ["CP", "CJ"], sans_objet: false },
  dettes_financieres: { codes: ["DF"], sans_objet: false },
  dettes_fournisseurs: { codes: ["DJ"], sans_objet: false },
  dettes_court_terme: { codes: ["DJ", "DX"], sans_objet: false },
  chiffre_affaires: { codes: ["XB"], sans_objet: false },
  cout_ventes: { codes: ["RA"], sans_objet: false },
  resultat_exploitation: { codes: [], sans_objet: true },
  charges_financieres: { codes: [], sans_objet: true },
  resultat_net: { codes: ["XI"], sans_objet: false },
};

type Reponses = Record<string, "non" | "partiellement" | "oui" | "inconnu">;

/** Deux évaluations rouges : la seconde est plus lourde (salaires et banque). */
export const URGENCES_M7: readonly { jour: string; reponses: Reponses; commentaire: string }[] = [
  {
    jour: "2026-07-14",
    commentaire:
      "Premier atelier avec la direction : trois clients opérateurs paient à plus de 120 jours.",
    reponses: {
      T1: "oui",
      T2: "partiellement",
      T3: "oui",
      A1: "oui",
      A2: "oui",
      A3: "partiellement",
      E1: "partiellement",
      E2: "oui",
      E3: "oui",
      S1: "non",
      S2: "partiellement",
      S3: "partiellement",
      F1: "partiellement",
      F2: "oui",
      F3: "partiellement",
    },
  },
  {
    jour: "2026-09-21",
    commentaire: "Aggravation depuis juillet : retards de salaires et mise en garde de la banque.",
    reponses: {
      T1: "oui",
      T2: "oui",
      T3: "oui",
      A1: "oui",
      A2: "oui",
      A3: "oui",
      E1: "partiellement",
      E2: "oui",
      E3: "oui",
      S1: "partiellement",
      S2: "oui",
      S3: "partiellement",
      F1: "oui",
      F2: "oui",
      F3: "partiellement",
    },
  },
];

export const SCORES_M7: readonly {
  jour: string;
  rejets: number;
  retards: number;
  arrieres: boolean;
}[] = [
  { jour: "2026-07-15", rejets: 2, retards: 3, arrieres: false },
  { jour: "2026-09-22", rejets: 3, retards: 6, arrieres: true },
];

export const REPONSES_DEPART_M7_LOT1 = [
  {
    item_id: "srv_tre_01",
    reponse: "non",
    commentaire: "Aucun prévisionnel de trésorerie avant l'arrivée du cabinet.",
  },
  { item_id: "srv_tre_02", reponse: "non" },
  { item_id: "srv_act_01", reponse: "partiel" },
  {
    item_id: "srv_act_02",
    reponse: "non",
    commentaire: "Deux opérateurs font 62 % du chiffre d'affaires.",
  },
  { item_id: "srv_exp_01", reponse: "partiel" },
] as const;

export const REPONSES_DEPART_M7_LOT2 = [
  {
    item_id: "srv_soc_01",
    reponse: "partiel",
    commentaire: "Salaires de septembre versés en deux fois.",
  },
  {
    item_id: "srv_tre_02",
    reponse: "partiel",
    commentaire: "Suivi des échéances fournisseurs en place depuis septembre.",
  },
] as const;
