/*
 * Hypothèses des modèles financiers du plan 6 (Baobab Assurances) : voir plans-coeur-modeles.ts pour
 * les conventions (XOF, taux en points, bilan d'ouverture équilibré).
 */
import { bilanOuverture, type Hypotheses } from "./plans-coeur-modeles.js";

/* ----- Plan 6 : Baobab Assurances (assurance), 2026-2030 (5 ans) ----- */

const baobabBase = {
  premierExercice: 2026,
  chiffreAffairesReference: 27_000_000_000,
  tauxChargesVariables: 5,
  effectifs: [
    {
      libelle: "Réseau commercial et agences",
      effectifs: [180, 186, 192, 196, 200],
      salaireAnnuelBrut: 4_000_000,
      tauxChargesSociales: 16,
      revalorisationAnnuelle: 3,
    },
    {
      libelle: "Technique, sinistres et actuariat",
      effectifs: [80, 84, 88, 90, 92],
      salaireAnnuelBrut: 7_000_000,
      tauxChargesSociales: 16,
      revalorisationAnnuelle: 3,
    },
    {
      libelle: "Direction et fonctions support",
      effectifs: [50, 52, 54, 54, 56],
      salaireAnnuelBrut: 11_000_000,
      tauxChargesSociales: 16,
      revalorisationAnnuelle: 3,
    },
  ],
  delaiClientsJours: 55,
  delaiFournisseursJours: 40,
  tauxImpotSocietes: 25,
  tauxDistributionDividendes: 30,
  tauxActualisation: 10,
  bilanOuverture: bilanOuverture({
    immobilisationsNettes: 5_800_000_000,
    dureeResiduelleImmobilisations: 12,
    stocks: 0,
    creancesClients: 4_200_000_000,
    tresorerie: 6_400_000_000,
    capital: 8_000_000_000,
    dettesFournisseurs: 1_600_000_000,
    empruntsEnCours: 0,
  }),
};

/** Version 1 (validée) : trajectoire de référence après le diagnostic. */
export const BAOBAB_V1: Hypotheses = {
  ...baobabBase,
  croissanceChiffreAffaires: [6, 8, 9, 9, 8],
  tauxMargeBrute: [35, 35.5, 36, 36.5, 37],
  chargesFixes: [3_100_000_000, 3_200_000_000, 3_320_000_000, 3_440_000_000, 3_560_000_000],
  investissements: [
    {
      libelle: "Refonte du système cœur de métier",
      annee: 1,
      montant: 2_400_000_000,
      dureeAmortissement: 6,
    },
    {
      libelle: "Canal de souscription digital",
      annee: 2,
      montant: 900_000_000,
      dureeAmortissement: 5,
    },
    { libelle: "Agences régionales", annee: 3, montant: 1_100_000_000, dureeAmortissement: 10 },
  ],
};

/** Version 2 (brouillon, en discussion) : accélération par les agences et un emprunt. */
export const BAOBAB_V2: Hypotheses = {
  ...baobabBase,
  croissanceChiffreAffaires: [6, 10, 11, 10, 9],
  tauxMargeBrute: [35, 35, 35.5, 36, 36.5],
  chargesFixes: [3_100_000_000, 3_350_000_000, 3_600_000_000, 3_800_000_000, 3_950_000_000],
  investissements: [
    {
      libelle: "Refonte du système cœur de métier",
      annee: 1,
      montant: 2_400_000_000,
      dureeAmortissement: 6,
    },
    {
      libelle: "Canal de souscription digital",
      annee: 2,
      montant: 900_000_000,
      dureeAmortissement: 5,
    },
    {
      libelle: "Agences régionales (12 nouvelles)",
      annee: 2,
      montant: 2_600_000_000,
      dureeAmortissement: 10,
    },
  ],
  emprunts: [
    {
      libelle: "Prêt réseau d'agences",
      anneeDeblocage: 2,
      montant: 1_800_000_000,
      tauxAnnuel: 7.5,
      duree: 7,
      differe: 1,
    },
  ],
};
