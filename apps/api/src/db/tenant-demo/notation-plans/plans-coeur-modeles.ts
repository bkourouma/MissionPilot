/*
 * Hypothèses des modèles financiers des plans (étape « plans-coeur »). Seules les HYPOTHÈSES sont
 * saisies ici ; états financiers, scénarios, VAN, TRI et bancabilité sortent du moteur
 * (`calculerScenariosPlan`) par les routes. Montants en XOF (unité mineure = 1 FCFA), taux en
 * points. Le bilan d'ouverture est construit équilibré : les réserves sont la différence entre
 * l'actif net et le passif connu (le moteur refuse un bilan d'ouverture déséquilibré).
 */

export interface BilanEntree {
  immobilisationsNettes: number;
  dureeResiduelleImmobilisations: number;
  stocks: number;
  creancesClients: number;
  tresorerie: number;
  capital: number;
  dettesFournisseurs: number;
  /** Capital restant dû des emprunts déjà en cours (anneeDeblocage 0). */
  empruntsEnCours: number;
}

/** Bilan d'ouverture équilibré : réserves = actif − (capital + fournisseurs + emprunts en cours). */
export function bilanOuverture(b: BilanEntree) {
  const actif = b.immobilisationsNettes + b.stocks + b.creancesClients + b.tresorerie;
  const reserves = actif - b.capital - b.dettesFournisseurs - b.empruntsEnCours;
  return {
    immobilisationsNettes: b.immobilisationsNettes,
    dureeResiduelleImmobilisations: b.dureeResiduelleImmobilisations,
    stocks: b.stocks,
    creancesClients: b.creancesClients,
    tresorerie: b.tresorerie,
    capital: b.capital,
    reserves,
    dettesFournisseurs: b.dettesFournisseurs,
  };
}

export type Hypotheses = Record<string, unknown>;

/* ----- Plan 1 : SICAFE (agro-industrie café-cacao), 2025-2028 (4 ans) ----- */

const sicafeBase = {
  premierExercice: 2025,
  chiffreAffairesReference: 9_600_000_000,
  tauxChargesVariables: 3.5,
  effectifs: [
    {
      libelle: "Production et conditionnement",
      effectifs: [380, 392, 404, 414],
      salaireAnnuelBrut: 1_800_000,
      tauxChargesSociales: 16.5,
      revalorisationAnnuelle: 3,
    },
    {
      libelle: "Encadrement, qualité et support",
      effectifs: [64, 66, 68, 70],
      salaireAnnuelBrut: 6_000_000,
      tauxChargesSociales: 16.5,
      revalorisationAnnuelle: 4,
    },
    {
      libelle: "Commercial et export",
      effectifs: [18, 20, 22, 24],
      salaireAnnuelBrut: 8_400_000,
      tauxChargesSociales: 16.5,
      revalorisationAnnuelle: 4,
    },
  ],
  delaiFournisseursJours: 45,
  tauxImpotSocietes: 25,
  tauxDistributionDividendes: 20,
  tauxActualisation: 12,
  bilanOuverture: bilanOuverture({
    immobilisationsNettes: 3_200_000_000,
    dureeResiduelleImmobilisations: 8,
    stocks: 1_100_000_000,
    creancesClients: 1_400_000_000,
    tresorerie: 600_000_000,
    capital: 1_500_000_000,
    dettesFournisseurs: 900_000_000,
    empruntsEnCours: 800_000_000,
  }),
};

/** Version 1 (cadrage) : trajectoire prudente, un seul investissement lourd. */
export const SICAFE_V1: Hypotheses = {
  ...sicafeBase,
  croissanceChiffreAffaires: [6, 8, 9, 7],
  tauxMargeBrute: [32.5, 33, 33.5, 34],
  chargesFixes: [1_050_000_000, 1_100_000_000, 1_160_000_000, 1_200_000_000],
  investissements: [
    {
      libelle: "Extension du séchage de Daloa",
      annee: 1,
      montant: 1_200_000_000,
      dureeAmortissement: 10,
    },
    {
      libelle: "Système d'information de production",
      annee: 2,
      montant: 400_000_000,
      dureeAmortissement: 5,
    },
  ],
  emprunts: [
    {
      libelle: "Prêt d'investissement en cours",
      anneeDeblocage: 0,
      montant: 800_000_000,
      tauxAnnuel: 7.5,
      duree: 4,
    },
    {
      libelle: "Prêt séchage Daloa",
      anneeDeblocage: 1,
      montant: 1_000_000_000,
      tauxAnnuel: 8,
      duree: 7,
      differe: 1,
    },
  ],
  delaiClientsJours: [52, 50, 48, 46],
  stocksJours: [38, 36, 34, 32],
};

/** Version 2 (après l'atelier de direction) : export plus rapide, tri optique ajouté. */
export const SICAFE_V2: Hypotheses = {
  ...sicafeBase,
  croissanceChiffreAffaires: [7, 9, 10, 8],
  tauxMargeBrute: [33, 33.5, 34, 34.5],
  chargesFixes: [1_050_000_000, 1_110_000_000, 1_170_000_000, 1_220_000_000],
  investissements: [
    {
      libelle: "Extension du séchage de Daloa",
      annee: 1,
      montant: 1_200_000_000,
      dureeAmortissement: 10,
    },
    {
      libelle: "Système d'information de production",
      annee: 2,
      montant: 400_000_000,
      dureeAmortissement: 5,
    },
    { libelle: "Chaîne de tri optique", annee: 3, montant: 650_000_000, dureeAmortissement: 8 },
  ],
  emprunts: [
    {
      libelle: "Prêt d'investissement en cours",
      anneeDeblocage: 0,
      montant: 800_000_000,
      tauxAnnuel: 7.5,
      duree: 4,
    },
    {
      libelle: "Prêt séchage Daloa",
      anneeDeblocage: 1,
      montant: 1_000_000_000,
      tauxAnnuel: 8,
      duree: 7,
      differe: 1,
    },
    {
      libelle: "Prêt tri optique",
      anneeDeblocage: 3,
      montant: 450_000_000,
      tauxAnnuel: 8,
      duree: 6,
      differe: 1,
    },
  ],
  delaiClientsJours: [52, 49, 46, 44],
  stocksJours: [38, 36, 33, 31],
};

/* ----- Plan 5 : Atlantique Retail (distribution), 2026-2030 (5 ans), business plan bancable ----- */

const atlantiqueBase = {
  premierExercice: 2026,
  chiffreAffairesReference: 24_000_000_000,
  tauxChargesVariables: 2,
  effectifs: [
    {
      libelle: "Vente et caisses",
      effectifs: [520, 560, 600, 628, 650],
      salaireAnnuelBrut: 1_600_000,
      tauxChargesSociales: 17,
      revalorisationAnnuelle: 3,
    },
    {
      libelle: "Encadrement magasins",
      effectifs: [60, 64, 68, 72, 74],
      salaireAnnuelBrut: 5_000_000,
      tauxChargesSociales: 17,
      revalorisationAnnuelle: 3,
    },
    {
      libelle: "Siège et logistique",
      effectifs: [28, 30, 32, 34, 34],
      salaireAnnuelBrut: 9_000_000,
      tauxChargesSociales: 17,
      revalorisationAnnuelle: 3,
    },
  ],
  delaiClientsJours: 8,
  delaiFournisseursJours: [62, 62, 60, 60, 58],
  stocksJours: [44, 43, 42, 41, 40],
  tauxImpotSocietes: 25,
  tauxDistributionDividendes: 15,
  tauxActualisation: 11,
  bilanOuverture: bilanOuverture({
    immobilisationsNettes: 6_500_000_000,
    dureeResiduelleImmobilisations: 9,
    stocks: 2_900_000_000,
    creancesClients: 600_000_000,
    tresorerie: 900_000_000,
    capital: 2_000_000_000,
    dettesFournisseurs: 3_400_000_000,
    empruntsEnCours: 1_200_000_000,
  }),
};

/** Version 1 : premier jet du dossier, financement 100 % dette (ratios tendus). */
export const ATLANTIQUE_V1: Hypotheses = {
  ...atlantiqueBase,
  croissanceChiffreAffaires: [9, 11, 10, 8, 7],
  tauxMargeBrute: [22, 22.5, 23, 23.5, 23.5],
  chargesFixes: [2_300_000_000, 2_450_000_000, 2_600_000_000, 2_700_000_000, 2_780_000_000],
  investissements: [
    { libelle: "Ouverture de 4 magasins", annee: 1, montant: 2_400_000_000, dureeAmortissement: 8 },
    { libelle: "Ouverture de 3 magasins", annee: 2, montant: 1_800_000_000, dureeAmortissement: 8 },
    { libelle: "Plateforme logistique", annee: 3, montant: 1_500_000_000, dureeAmortissement: 12 },
    { libelle: "Rénovation du parc", annee: 4, montant: 900_000_000, dureeAmortissement: 6 },
  ],
  emprunts: [
    {
      libelle: "Crédit en cours",
      anneeDeblocage: 0,
      montant: 1_200_000_000,
      tauxAnnuel: 8,
      duree: 3,
    },
    {
      libelle: "Crédit d'investissement réseau",
      anneeDeblocage: 1,
      montant: 4_200_000_000,
      tauxAnnuel: 9,
      duree: 7,
      differe: 1,
    },
    {
      libelle: "Crédit plateforme logistique",
      anneeDeblocage: 3,
      montant: 1_500_000_000,
      tauxAnnuel: 8.5,
      duree: 7,
      differe: 1,
    },
  ],
};

/** Version 2 : ouverture du capital (1,8 Mrd) et déblocages lissés, présentée aux banques. */
export const ATLANTIQUE_V2: Hypotheses = {
  ...atlantiqueBase,
  croissanceChiffreAffaires: [9, 11, 10, 8, 7],
  tauxMargeBrute: [22, 22.5, 23, 23.5, 23.5],
  chargesFixes: [2_300_000_000, 2_450_000_000, 2_600_000_000, 2_700_000_000, 2_780_000_000],
  investissements: [
    { libelle: "Ouverture de 4 magasins", annee: 1, montant: 2_400_000_000, dureeAmortissement: 8 },
    { libelle: "Ouverture de 3 magasins", annee: 2, montant: 1_800_000_000, dureeAmortissement: 8 },
    { libelle: "Plateforme logistique", annee: 3, montant: 1_500_000_000, dureeAmortissement: 12 },
    { libelle: "Rénovation du parc", annee: 4, montant: 900_000_000, dureeAmortissement: 6 },
  ],
  emprunts: [
    {
      libelle: "Crédit en cours",
      anneeDeblocage: 0,
      montant: 1_200_000_000,
      tauxAnnuel: 8,
      duree: 3,
    },
    {
      libelle: "Crédit d'investissement réseau",
      anneeDeblocage: 1,
      montant: 2_400_000_000,
      tauxAnnuel: 9,
      duree: 7,
      differe: 1,
    },
    {
      libelle: "Crédit plateforme logistique",
      anneeDeblocage: 3,
      montant: 1_100_000_000,
      tauxAnnuel: 8.5,
      duree: 7,
      differe: 1,
    },
  ],
  augmentationsCapital: [{ annee: 1, montant: 1_800_000_000 }],
};
