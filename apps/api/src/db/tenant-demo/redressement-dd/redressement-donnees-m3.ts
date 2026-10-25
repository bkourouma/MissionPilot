/*
 * Données du dossier « Redressement — Brasseries du Wouri » (mission 3, 10 mars au 14 novembre 2025),
 * client industriel de l'agroalimentaire. Les états financiers (2024 et 2025) sont ceux du socle ;
 * ce fichier décrit la CORRESPONDANCE de leurs lignes avec les postes du moteur, les réponses au
 * questionnaire d'urgence (qui s'allègent au fil des mois), les incidents de paiement des scores
 * d'alerte, les check-lists et les textes du suivi. Aucun chiffre financier calculé n'est écrit
 * ici : ratios, scores, voyants et leviers sortent des moteurs.
 *
 * Codes des lignes du socle : A1 immobilisations, A2 stocks, A3 créances clients et autres, A4
 * trésorerie ; P1 capitaux, P2 résultat, P3 dettes financières, P4 dettes d'exploitation ; C1 achats
 * consommés, C3 autres charges ; R1 ventes ; RN résultat net.
 */

export const CORRESPONDANCE_PARTIELLE = {
  stocks: { codes: ["A2"], sans_objet: false },
  creances_clients: { codes: ["A3"], sans_objet: false },
  tresorerie_actif: { codes: ["A4"], sans_objet: false },
  dettes_financieres: { codes: ["P3"], sans_objet: false },
  chiffre_affaires: { codes: ["R1"], sans_objet: false },
  resultat_net: { codes: ["RN"], sans_objet: false },
};

export const CORRESPONDANCE_COMPLETE = {
  ...CORRESPONDANCE_PARTIELLE,
  // Le socle regroupe créances clients et autres créances sur une seule ligne.
  autres_creances: { codes: [], sans_objet: true },
  capitaux_propres: { codes: ["P1", "P2"], sans_objet: false },
  dettes_fournisseurs: { codes: ["P4"], sans_objet: false },
  dettes_court_terme: { codes: ["P4"], sans_objet: false },
  cout_ventes: { codes: ["C1"], sans_objet: false },
  // Le socle ne détaille ni le résultat d'exploitation ni les charges financières.
  resultat_exploitation: { codes: [], sans_objet: true },
  charges_financieres: { codes: [], sans_objet: true },
};

type Reponses = Record<string, "non" | "partiellement" | "oui" | "inconnu">;

/** Cinq évaluations : rouge (mars), orange (mai, juillet), vert (septembre, novembre). */
export const URGENCES_M3: readonly { jour: string; reponses: Reponses; commentaire: string }[] = [
  {
    jour: "2025-03-14",
    commentaire:
      "Premier entretien avec la direction financière : retards de paiement généralisés.",
    reponses: {
      T1: "oui",
      T2: "oui",
      T3: "oui",
      A1: "non",
      A2: "partiellement",
      A3: "partiellement",
      E1: "non",
      E2: "oui",
      E3: "partiellement",
      S1: "non",
      S2: "partiellement",
      S3: "oui",
      F1: "partiellement",
      F2: "non",
      F3: "non",
    },
  },
  {
    jour: "2025-05-09",
    commentaire: "Après les premiers accords d'étalement : la pression des fournisseurs baisse.",
    reponses: {
      T1: "partiellement",
      T2: "non",
      T3: "partiellement",
      A1: "non",
      A2: "non",
      A3: "partiellement",
      E1: "non",
      E2: "partiellement",
      E3: "partiellement",
      S1: "non",
      S2: "non",
      S3: "oui",
      F1: "non",
      F2: "non",
      F3: "non",
    },
  },
  {
    jour: "2025-07-18",
    commentaire: "Vigilance maintenue sur les stocks et le suivi de gestion.",
    reponses: {
      T1: "non",
      T2: "non",
      T3: "partiellement",
      A1: "non",
      A2: "non",
      A3: "non",
      E1: "non",
      E2: "partiellement",
      E3: "partiellement",
      S1: "non",
      S2: "non",
      S3: "partiellement",
      F1: "non",
      F2: "non",
      F3: "non",
    },
  },
  {
    jour: "2025-09-26",
    commentaire: "Plus aucun signal de tension sur les paiements ; suivi de gestion rétabli.",
    reponses: {
      T1: "non",
      T2: "non",
      T3: "non",
      A1: "non",
      A2: "non",
      A3: "non",
      E1: "non",
      E2: "non",
      E3: "partiellement",
      S1: "non",
      S2: "non",
      S3: "partiellement",
      F1: "non",
      F2: "non",
      F3: "non",
    },
  },
  {
    jour: "2025-11-03",
    commentaire: "Évaluation de clôture avec la direction générale.",
    reponses: {
      T1: "non",
      T2: "non",
      T3: "non",
      A1: "non",
      A2: "non",
      A3: "non",
      E1: "non",
      E2: "non",
      E3: "non",
      S1: "non",
      S2: "non",
      S3: "partiellement",
      F1: "non",
      F2: "non",
      F3: "non",
    },
  },
];

/** Scores d'alerte : seuils en vigueur au jour du calcul (industrie v1, puis v2 à partir de juillet). */
export const SCORES_M3: readonly {
  jour: string;
  rejets: number;
  retards: number;
  arrieres: boolean;
}[] = [
  { jour: "2025-03-24", rejets: 4, retards: 9, arrieres: true },
  { jour: "2025-05-12", rejets: 2, retards: 5, arrieres: true },
  { jour: "2025-07-21", rejets: 1, retards: 2, arrieres: false },
  { jour: "2025-10-27", rejets: 0, retards: 0, arrieres: false },
];

/** Réponses de la check-list de départ « industrie » (lot 1 puis lot 2 avec une correction). */
export const REPONSES_DEPART_M3_LOT1 = [
  {
    item_id: "ind_tre_01",
    reponse: "non",
    commentaire: "Prévisionnel reconstruit avec le cabinet.",
  },
  { item_id: "ind_tre_02", reponse: "partiel" },
  { item_id: "ind_act_01", reponse: "oui" },
  {
    item_id: "ind_act_02",
    reponse: "partiel",
    commentaire: "Deux distributeurs font 40 % des ventes.",
  },
  { item_id: "ind_exp_01", reponse: "oui" },
  {
    item_id: "ind_exp_02",
    reponse: "non",
    commentaire: "Stocks de matières au-dessus de six semaines.",
  },
] as const;

export const REPONSES_DEPART_M3_LOT2 = [
  { item_id: "ind_exp_03", reponse: "partiel" },
  { item_id: "ind_soc_01", reponse: "oui" },
  {
    item_id: "ind_fin_01",
    reponse: "non",
    commentaire: "Plusieurs emprunts échus non renégociés.",
  },
  { item_id: "ind_fin_02", reponse: "partiel" },
  // Correction d'une réponse du premier lot après la revue des stocks.
  { item_id: "ind_exp_02", reponse: "partiel", commentaire: "Stocks ramenés à quatre semaines." },
] as const;

export const REPONSES_MODELE_M3_LOT1 = [
  { item_id: "bra_tre_01", reponse: "oui" },
  {
    item_id: "bra_tre_02",
    reponse: "partiel",
    commentaire: "Rapprochement mensuel, pas hebdomadaire.",
  },
  { item_id: "bra_act_01", reponse: "oui" },
  { item_id: "bra_exp_01", reponse: "oui" },
] as const;

export const REPONSES_MODELE_M3_LOT2 = [
  { item_id: "bra_exp_02", reponse: "partiel", commentaire: "Inventaire trimestriel des casiers." },
  { item_id: "bra_soc_01", reponse: "oui" },
  { item_id: "bra_fin_01", reponse: "oui" },
  { item_id: "bra_fin_02", reponse: "oui" },
  {
    item_id: "bra_tre_02",
    reponse: "oui",
    commentaire: "Rapprochement hebdomadaire en place depuis septembre.",
  },
] as const;

/* ----- Suivi post-mission ----- */

export const RELEVE_SUIVI_JALON_1 = {
  jour: "2026-05-12",
  // Indicateurs saisis à partir des comptes semestriels du client (points de base).
  ratios: { liquidite_generale: 21_400, autonomie_financiere: 5_300, endettement: 3_900 },
  commentaire: "Comptes semestriels 2026 remis par la direction financière : indicateurs stables.",
} as const;

export const RELEVE_SUIVI_JALON_2 = {
  jour: "2026-09-10",
  // Dégradation volontaire : liquidité et autonomie en baisse, endettement en hausse.
  ratios: { liquidite_generale: 17_800, autonomie_financiere: 4_300, endettement: 5_900 },
  commentaire:
    "Point intermédiaire avant le jalon à 12 mois : investissement de capacité financé par la dette.",
} as const;
