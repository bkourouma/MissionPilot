/**
 * Modèle financier d'un plan stratégique (PLA-06, PLA-07, PLA-09) : types des réponses de
 * l'API (résultat figé du moteur `engines/plan-strategique`), lignes des états, libellés,
 * alertes, scénarios, comparaison, ROI et messages. Logique pure, testée dans
 * `plan-modele.test.ts`.
 *
 * RÈGLE : aucun chiffre n'est calculé ici. États financiers, indicateurs, scénarios, alertes,
 * VAN et TRI viennent TELS QUELS de l'API (et de son moteur) ; ce module choisit des champs et
 * les met en forme (montants dans la devise du plan, en unités mineures). Le web n'importe pas
 * `@missionpilot/engines` (CODING_STANDARDS §1) : les types ci-dessous reprennent la forme du
 * résultat sérialisé par l'API.
 *
 * Simplifications du moteur (en-tête de `packages/engines/src/plan-strategique/modele.ts`) :
 * format SYSCOHADA révisé simplifié, amortissement linéaire en année pleine, impôt payé dans
 * l'exercice, pas d'opérations HAO, de cessions ni de provisions, pas de frais de découvert.
 * Les codes de postes SYSCOHADA affichés sont INDICATIFS (à confirmer par un expert-comptable).
 */
import { ErreurApi, messageErreur } from "./api";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";

const NBSP = " ";

// --- Résultat du moteur (forme sérialisée par l'API) ------------------------------------------

export type NomScenario = "base" | "optimiste" | "pessimiste";
export const SCENARIOS: readonly NomScenario[] = ["base", "optimiste", "pessimiste"];
export const SCENARIO_LIBELLES: Record<NomScenario, string> = {
  base: "Base",
  optimiste: "Optimiste",
  pessimiste: "Pessimiste",
};

export interface CompteResultatPlan {
  chiffreAffaires: number;
  achatsConsommes: number;
  margeBrute: number;
  chargesExternesVariables: number;
  chargesExternesFixes: number;
  valeurAjoutee: number;
  chargesPersonnel: number;
  excedentBrutExploitation: number;
  dotationsAmortissements: number;
  resultatExploitation: number;
  fraisFinanciers: number;
  resultatFinancier: number;
  resultatActivitesOrdinaires: number;
  impotSurResultat: number;
  resultatNet: number;
}

export interface BilanPlan {
  immobilisationsNettes: number;
  stocks: number;
  creancesClients: number;
  tresorerieActif: number;
  totalActif: number;
  capital: number;
  reserves: number;
  resultatExercice: number;
  capitauxPropres: number;
  dettesFinancieres: number;
  dettesFournisseurs: number;
  tresoreriePassif: number;
  totalPassif: number;
  tresorerieNette: number;
  besoinFondsRoulement: number;
}

export interface FluxTresoreriePlan {
  tresorerieOuverture: number;
  capaciteAutofinancement: number;
  variationBesoinFondsRoulement: number;
  fluxActivitesOperationnelles: number;
  acquisitionsImmobilisations: number;
  fluxInvestissement: number;
  augmentationsCapital: number;
  dividendesVerses: number;
  fluxCapitauxPropres: number;
  empruntsNouveaux: number;
  remboursementsEmprunts: number;
  fluxCapitauxEtrangers: number;
  fluxFinancement: number;
  variationTresorerie: number;
  tresorerieCloture: number;
}

export interface IndicateursPlan {
  excedentBrutExploitation: number;
  resultatNet: number;
  capaciteAutofinancement: number;
  tresorerieFinExercice: number;
  pointMort: number | null;
  pointMortJours: number | null;
  tauxMargeCoutsVariables: number | null;
  impotNormatif: number;
  fluxLibre: number;
  endettementNet: number;
  ratioEndettement: number | null;
  capaciteRemboursement: number | null;
  autonomieFinanciere: number | null;
  couvertureServiceDette: number | null;
}

export interface ExercicePlan {
  annee: number;
  exercice: number;
  compteResultat: CompteResultatPlan;
  bilan: BilanPlan;
  fluxTresorerie: FluxTresoreriePlan;
  indicateurs: IndicateursPlan;
  controle: { totalActif: number; totalPassif: number; ecart: number; equilibre: boolean };
}

export interface SyntheseResultat {
  chiffreAffairesFinal: number;
  resultatNetCumule: number;
  capaciteAutofinancementCumulee: number;
  tresorerieFinale: number;
  fluxLibres: number[];
  /** En points (12 pour 12 %). */
  tauxActualisation: number;
  valeurActuelleNette: number;
  /** Fraction (0,1 = 10 %) ; null si non défini. */
  tauxRendementInterne: number | null;
}

export type CodeAlertePlan =
  | "TRESORERIE_NEGATIVE"
  | "CAPITAUX_PROPRES_NEGATIFS"
  | "CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL"
  | "BILAN_DESEQUILIBRE";

export interface AlertePlan {
  code: string;
  gravite: "critique" | "attention";
  annee: number;
  exercice: number;
  montant: number;
  seuil: number;
}

export interface EcheanceEmprunt {
  rang: number;
  annee: number;
  capitalDebut: number;
  interets: number;
  amortissement: number;
  annuite: number;
  capitalFin: number;
}

export interface EcheancierEmprunt {
  libelle: string;
  anneeDeblocage: number;
  montant: number;
  echeances: EcheanceEmprunt[];
  totalInterets: number;
}

export interface ResultatPlan {
  devise: Devise;
  horizon: number;
  premierExercice: number;
  annees: ExercicePlan[];
  echeanciers: EcheancierEmprunt[];
  synthese: SyntheseResultat;
  equilibre: boolean;
  alertes: AlertePlan[];
}

export interface SyntheseScenario {
  scenario: NomScenario;
  chiffreAffairesFinal: number;
  resultatNetCumule: number;
  tresorerieFinale: number;
  valeurActuelleNette: number;
  tauxRendementInterne: number | null;
  nombreAlertes: number;
}

export interface EcartsScenario {
  croissanceChiffreAffaires?: number;
  tauxMargeBrute?: number;
  tauxChargesVariables?: number;
  chargesFixes?: number;
  delaiClientsJours?: number;
}

export interface EcartsScenarios {
  optimiste: EcartsScenario;
  pessimiste: EcartsScenario;
}

export interface ResultatScenarios {
  base: ResultatPlan;
  optimiste: ResultatPlan;
  pessimiste: ResultatPlan;
  ecarts: EcartsScenarios;
  synthese: SyntheseScenario[];
}

// --- Versions du modèle -----------------------------------------------------------------------

export interface ValidationModele {
  valide_par: string;
  valideur_nom: string | null;
  valide_le: string;
}

/** Résumé d'une version (liste, dernière version d'un plan). */
export interface ResumeModele {
  id: string;
  version: number;
  moteur: string;
  commentaire: string | null;
  cree_par: string;
  auteur_nom: string;
  calcule_le: string;
  validation: ValidationModele | null;
  equilibre: boolean;
  synthese: SyntheseScenario[];
  alertes: AlertePlan[];
}

/** Hypothèses telles qu'enregistrées (saisie + horizon et devise du plan ajoutés par l'API). */
export type ParAnnee = number | number[];

export interface HypothesesEnregistrees {
  premierExercice: number;
  chiffreAffairesReference: number;
  croissanceChiffreAffaires: ParAnnee;
  tauxMargeBrute: ParAnnee;
  tauxChargesVariables?: ParAnnee;
  chargesFixes?: ParAnnee;
  effectifs?: {
    libelle: string;
    effectifs: ParAnnee;
    salaireAnnuelBrut: number;
    tauxChargesSociales: number;
    revalorisationAnnuelle?: number;
  }[];
  investissements?: {
    libelle: string;
    annee: number;
    montant: number;
    dureeAmortissement: number;
  }[];
  emprunts?: {
    libelle: string;
    anneeDeblocage: number;
    montant: number;
    tauxAnnuel: number;
    duree: number;
    differe?: number;
    mode?: "annuites_constantes" | "amortissement_constant";
  }[];
  augmentationsCapital?: { annee: number; montant: number }[];
  delaiClientsJours?: ParAnnee;
  delaiFournisseursJours?: ParAnnee;
  stocksJours?: ParAnnee;
  tauxImpotSocietes?: number;
  tauxDistributionDividendes?: number;
  tauxActualisation?: number;
  bilanOuverture?: Partial<Record<string, number>>;
  horizon?: number;
  devise?: string;
}

/** Hypothèses envoyées à l'API : SANS horizon ni devise (ceux du plan s'imposent). */
export type HypothesesSaisies = Omit<HypothesesEnregistrees, "horizon" | "devise">;

export interface VersionModele extends ResumeModele {
  hypotheses: HypothesesEnregistrees;
  ecarts: EcartsScenarios;
  resultat: ResultatScenarios;
}

/** Réponse de POST /plans/:id/modeles/simulation (rien n'est enregistré). */
export interface SimulationModele {
  hypotheses: HypothesesEnregistrees;
  ecarts: EcartsScenarios;
  resultat: ResultatScenarios;
}

export interface PageVersionsModele {
  elements: ResumeModele[];
  curseur_suivant: string | null;
}

export interface PointSerie {
  exercice: number;
  valeur: number;
}

/** Écart calculé par le moteur de l'API (a − de exact, écart relatif à 4 décimales). */
export interface EcartCompare {
  de: number | null;
  a: number | null;
  ecart: number | null;
  ecart_relatif: number | null;
}

export interface PointCompare extends EcartCompare {
  exercice: number;
}

export interface SerieComparee {
  cle: string;
  libelle: string;
  de: PointSerie[];
  a: PointSerie[];
  /** Exercices alignés par millésime, avec écarts du moteur. */
  points?: PointCompare[];
}

export interface IndicateurCompare extends EcartCompare {
  cle: string;
  libelle: string;
  /** « taux » : fraction (TRI), écart en points ; « nombre » : décompte (alertes). */
  nature: "montant" | "taux" | "nombre";
}

export interface ComparaisonModeles {
  de: ResumeModele;
  a: ResumeModele;
  hypotheses_modifiees: string[];
  /** Valeurs des hypothèses modifiées dans chaque version. */
  hypotheses_detail?: { chemin: string; de: unknown; a: unknown }[];
  ecarts_modifies: string[];
  series: SerieComparee[];
  /** Indicateurs de synthèse de chaque scénario, avec écarts du moteur. */
  synthese?: { scenario: NomScenario; indicateurs: IndicateurCompare[] }[];
}

export interface RoiInitiative {
  id: string;
  titre: string;
  statut_contenu: string;
  budget: number;
  gains_annuels: number[] | null;
  flux: number[] | null;
  valeur_actuelle_nette: number | null;
  taux_rendement_interne: number | null;
}

export interface RoiPlan {
  plan_id: string;
  modele_version: number | null;
  taux_actualisation: number;
  source_taux: "modele" | "defaut";
  initiatives: RoiInitiative[];
}

/** Plafond de versions du modèle par plan (API : 409 PLAN_PLAFOND_VERSIONS, doublé en base). */
export const VERSIONS_MODELE_MAX = 200;

/** Année commerciale du moteur : un point mort au-delà n'est pas atteint dans l'exercice. */
export const JOURS_EXERCICE = 360;

// --- Mise en forme ----------------------------------------------------------------------------

export type FormatValeur = "montant" | "pourcentage" | "multiple" | "annees" | "jours";

/** Valeur d'une ligne, mise en forme sans calcul (« — » si absente ou non définie). */
export function formaterValeur(
  format: FormatValeur,
  valeur: number | null | undefined,
  devise: Devise,
): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  switch (format) {
    case "montant":
      return formaterMontantMineur(valeur, devise);
    case "pourcentage":
      return formaterPourcentage(valeur, 1);
    case "multiple":
      return formaterNombre(valeur, 2);
    case "annees":
      return `${formaterNombre(valeur, 2)}${NBSP}an${Math.abs(valeur) >= 2 ? "s" : ""}`;
    case "jours":
      return valeur > JOURS_EXERCICE
        ? `${formaterNombre(valeur, 0)}${NBSP}jours (non atteint dans l'exercice)`
        : `${formaterNombre(valeur, 0)}${NBSP}jours`;
  }
}

/** Taux exprimé en points par le moteur (12 → « 12 % »). */
export function formaterPoints(points: number | null | undefined): string {
  if (typeof points !== "number" || !Number.isFinite(points)) return VALEUR_ABSENTE;
  return `${formaterNombre(points, 2)}${NBSP}%`;
}

/** Nombre signé pour un écart (+5, −2, 0). */
export function formaterSigne(v: number): string {
  return v > 0 ? `+${formaterNombre(v, 2)}` : formaterNombre(v, 2);
}

// --- Lignes des états (champs du résultat, sans arithmétique) --------------------------------

export interface LigneEtat {
  cle: string;
  libelle: string;
  /** Code de poste SYSCOHADA révisé, INDICATIF. */
  code: string | null;
  format: FormatValeur;
  /** Solde ou total mis en évidence. */
  total?: boolean;
  /** Intertitre affiché avant la ligne (Actif, Passif…). */
  groupe?: string;
  valeur: (a: ExercicePlan) => number | null;
}

export interface EtatFinancier {
  cle: "compte_resultat" | "bilan" | "flux_tresorerie" | "indicateurs";
  titre: string;
  lignes: readonly LigneEtat[];
}

const cr = (a: ExercicePlan) => a.compteResultat;
const bi = (a: ExercicePlan) => a.bilan;
const fl = (a: ExercicePlan) => a.fluxTresorerie;
const ind = (a: ExercicePlan) => a.indicateurs;

export const LIGNES_COMPTE_RESULTAT: readonly LigneEtat[] = [
  {
    cle: "chiffre_affaires",
    libelle: "Chiffre d'affaires",
    code: "XB",
    format: "montant",
    valeur: (a) => cr(a).chiffreAffaires,
  },
  {
    cle: "achats_consommes",
    libelle: "Achats consommés",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).achatsConsommes,
  },
  {
    cle: "marge_brute",
    libelle: "Marge brute",
    code: null,
    format: "montant",
    total: true,
    valeur: (a) => cr(a).margeBrute,
  },
  {
    cle: "charges_externes_variables",
    libelle: "Charges externes variables",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).chargesExternesVariables,
  },
  {
    cle: "charges_externes_fixes",
    libelle: "Charges externes fixes",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).chargesExternesFixes,
  },
  {
    cle: "valeur_ajoutee",
    libelle: "Valeur ajoutée",
    code: "XC",
    format: "montant",
    total: true,
    valeur: (a) => cr(a).valeurAjoutee,
  },
  {
    cle: "charges_personnel",
    libelle: "Charges de personnel",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).chargesPersonnel,
  },
  {
    cle: "excedent_brut_exploitation",
    libelle: "Excédent brut d'exploitation (EBE)",
    code: "XD",
    format: "montant",
    total: true,
    valeur: (a) => cr(a).excedentBrutExploitation,
  },
  {
    cle: "dotations_amortissements",
    libelle: "Dotations aux amortissements",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).dotationsAmortissements,
  },
  {
    cle: "resultat_exploitation",
    libelle: "Résultat d'exploitation",
    code: "XE",
    format: "montant",
    total: true,
    valeur: (a) => cr(a).resultatExploitation,
  },
  {
    cle: "frais_financiers",
    libelle: "Frais financiers",
    code: null,
    format: "montant",
    valeur: (a) => cr(a).fraisFinanciers,
  },
  {
    cle: "resultat_financier",
    libelle: "Résultat financier",
    code: "XF",
    format: "montant",
    valeur: (a) => cr(a).resultatFinancier,
  },
  {
    cle: "resultat_activites_ordinaires",
    libelle: "Résultat des activités ordinaires",
    code: "XG",
    format: "montant",
    total: true,
    valeur: (a) => cr(a).resultatActivitesOrdinaires,
  },
  {
    cle: "impot_sur_resultat",
    libelle: "Impôt sur le résultat",
    code: "RS",
    format: "montant",
    valeur: (a) => cr(a).impotSurResultat,
  },
  {
    cle: "resultat_net",
    libelle: "Résultat net",
    code: "XI",
    format: "montant",
    total: true,
    valeur: (a) => cr(a).resultatNet,
  },
];

export const LIGNES_BILAN: readonly LigneEtat[] = [
  {
    cle: "immobilisations_nettes",
    groupe: "Actif",
    libelle: "Immobilisations nettes",
    code: "AZ",
    format: "montant",
    valeur: (a) => bi(a).immobilisationsNettes,
  },
  { cle: "stocks", libelle: "Stocks", code: "BB", format: "montant", valeur: (a) => bi(a).stocks },
  {
    cle: "creances_clients",
    libelle: "Créances clients",
    code: "BI",
    format: "montant",
    valeur: (a) => bi(a).creancesClients,
  },
  {
    cle: "tresorerie_actif",
    libelle: "Trésorerie-actif",
    code: "BT",
    format: "montant",
    valeur: (a) => bi(a).tresorerieActif,
  },
  {
    cle: "total_actif",
    libelle: "Total actif",
    code: "BZ",
    format: "montant",
    total: true,
    valeur: (a) => bi(a).totalActif,
  },
  {
    cle: "capital",
    groupe: "Passif",
    libelle: "Capital",
    code: "CA",
    format: "montant",
    valeur: (a) => bi(a).capital,
  },
  {
    cle: "reserves",
    libelle: "Réserves et report à nouveau",
    code: null,
    format: "montant",
    valeur: (a) => bi(a).reserves,
  },
  {
    cle: "resultat_exercice",
    libelle: "Résultat de l'exercice",
    code: "CJ",
    format: "montant",
    valeur: (a) => bi(a).resultatExercice,
  },
  {
    cle: "capitaux_propres",
    libelle: "Capitaux propres",
    code: "CP",
    format: "montant",
    total: true,
    valeur: (a) => bi(a).capitauxPropres,
  },
  {
    cle: "dettes_financieres",
    libelle: "Dettes financières",
    code: "DD",
    format: "montant",
    valeur: (a) => bi(a).dettesFinancieres,
  },
  {
    cle: "dettes_fournisseurs",
    libelle: "Dettes fournisseurs",
    code: "DJ",
    format: "montant",
    valeur: (a) => bi(a).dettesFournisseurs,
  },
  {
    cle: "tresorerie_passif",
    libelle: "Trésorerie-passif (concours bancaires)",
    code: "DT",
    format: "montant",
    valeur: (a) => bi(a).tresoreriePassif,
  },
  {
    cle: "total_passif",
    libelle: "Total passif",
    code: "DZ",
    format: "montant",
    total: true,
    valeur: (a) => bi(a).totalPassif,
  },
  {
    cle: "tresorerie_nette",
    groupe: "Pour information",
    libelle: "Trésorerie nette",
    code: null,
    format: "montant",
    valeur: (a) => bi(a).tresorerieNette,
  },
  {
    cle: "besoin_fonds_roulement",
    libelle: "Besoin en fonds de roulement",
    code: null,
    format: "montant",
    valeur: (a) => bi(a).besoinFondsRoulement,
  },
];

export const LIGNES_FLUX: readonly LigneEtat[] = [
  {
    cle: "tresorerie_ouverture",
    libelle: "Trésorerie d'ouverture",
    code: "ZA",
    format: "montant",
    valeur: (a) => fl(a).tresorerieOuverture,
  },
  {
    cle: "capacite_autofinancement",
    groupe: "Activités opérationnelles",
    libelle: "Capacité d'autofinancement (CAF)",
    code: "FA",
    format: "montant",
    valeur: (a) => fl(a).capaciteAutofinancement,
  },
  {
    cle: "variation_bfr",
    libelle: "Variation du besoin en fonds de roulement (hausse = emploi)",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).variationBesoinFondsRoulement,
  },
  {
    cle: "flux_activites_operationnelles",
    libelle: "Flux des activités opérationnelles",
    code: "ZB",
    format: "montant",
    total: true,
    valeur: (a) => fl(a).fluxActivitesOperationnelles,
  },
  {
    cle: "acquisitions",
    groupe: "Investissement",
    libelle: "Acquisitions d'immobilisations",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).acquisitionsImmobilisations,
  },
  {
    cle: "flux_investissement",
    libelle: "Flux des activités d'investissement",
    code: "ZC",
    format: "montant",
    total: true,
    valeur: (a) => fl(a).fluxInvestissement,
  },
  {
    cle: "augmentations_capital",
    groupe: "Financement",
    libelle: "Augmentations de capital",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).augmentationsCapital,
  },
  {
    cle: "dividendes_verses",
    libelle: "Dividendes versés",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).dividendesVerses,
  },
  {
    cle: "flux_capitaux_propres",
    libelle: "Flux des capitaux propres",
    code: "ZD",
    format: "montant",
    valeur: (a) => fl(a).fluxCapitauxPropres,
  },
  {
    cle: "emprunts_nouveaux",
    libelle: "Emprunts nouveaux",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).empruntsNouveaux,
  },
  {
    cle: "remboursements_emprunts",
    libelle: "Remboursements d'emprunts",
    code: null,
    format: "montant",
    valeur: (a) => fl(a).remboursementsEmprunts,
  },
  {
    cle: "flux_capitaux_etrangers",
    libelle: "Flux des capitaux étrangers",
    code: "ZE",
    format: "montant",
    valeur: (a) => fl(a).fluxCapitauxEtrangers,
  },
  {
    cle: "flux_financement",
    libelle: "Flux des activités de financement",
    code: "ZF",
    format: "montant",
    total: true,
    valeur: (a) => fl(a).fluxFinancement,
  },
  {
    cle: "variation_tresorerie",
    groupe: "Trésorerie",
    libelle: "Variation de la trésorerie",
    code: "ZG",
    format: "montant",
    valeur: (a) => fl(a).variationTresorerie,
  },
  {
    cle: "tresorerie_cloture",
    libelle: "Trésorerie de clôture",
    code: "ZH",
    format: "montant",
    total: true,
    valeur: (a) => fl(a).tresorerieCloture,
  },
];

export const LIGNES_INDICATEURS: readonly LigneEtat[] = [
  {
    cle: "ebe",
    libelle: "Excédent brut d'exploitation (EBE)",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).excedentBrutExploitation,
  },
  {
    cle: "resultat_net",
    libelle: "Résultat net",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).resultatNet,
  },
  {
    cle: "caf",
    libelle: "Capacité d'autofinancement (CAF)",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).capaciteAutofinancement,
  },
  {
    cle: "tresorerie",
    libelle: "Trésorerie de fin d'exercice",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).tresorerieFinExercice,
  },
  {
    cle: "point_mort",
    libelle: "Point mort (chiffre d'affaires)",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).pointMort,
  },
  {
    cle: "point_mort_jours",
    libelle: "Point mort (date, en jours)",
    code: null,
    format: "jours",
    valeur: (a) => ind(a).pointMortJours,
  },
  {
    cle: "taux_marge_couts_variables",
    libelle: "Taux de marge sur coûts variables",
    code: null,
    format: "pourcentage",
    valeur: (a) => ind(a).tauxMargeCoutsVariables,
  },
  {
    cle: "flux_libre",
    libelle: "Flux de trésorerie disponible",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).fluxLibre,
  },
  {
    cle: "endettement_net",
    libelle: "Endettement net",
    code: null,
    format: "montant",
    valeur: (a) => ind(a).endettementNet,
  },
  {
    cle: "ratio_endettement",
    libelle: "Dettes financières / capitaux propres",
    code: null,
    format: "multiple",
    valeur: (a) => ind(a).ratioEndettement,
  },
  {
    cle: "capacite_remboursement",
    libelle: "Capacité de remboursement (dettes / CAF)",
    code: null,
    format: "annees",
    valeur: (a) => ind(a).capaciteRemboursement,
  },
  {
    cle: "autonomie_financiere",
    libelle: "Autonomie financière (capitaux propres / total du bilan)",
    code: null,
    format: "pourcentage",
    valeur: (a) => ind(a).autonomieFinanciere,
  },
  {
    cle: "couverture_service_dette",
    libelle: "Couverture du service de la dette",
    code: null,
    format: "multiple",
    valeur: (a) => ind(a).couvertureServiceDette,
  },
];

export const ETATS_FINANCIERS: readonly EtatFinancier[] = [
  {
    cle: "compte_resultat",
    titre: "Compte de résultat prévisionnel",
    lignes: LIGNES_COMPTE_RESULTAT,
  },
  { cle: "bilan", titre: "Bilan prévisionnel (clôture)", lignes: LIGNES_BILAN },
  { cle: "flux_tresorerie", titre: "Tableau des flux de trésorerie", lignes: LIGNES_FLUX },
  { cle: "indicateurs", titre: "Indicateurs et ratios", lignes: LIGNES_INDICATEURS },
];

/** Lignes regroupées sous leurs intertitres (Actif, Passif…) ; un groupe sans titre en tête. */
export function grouperLignes(
  lignes: readonly LigneEtat[],
): { titre: string | null; lignes: LigneEtat[] }[] {
  const groupes: { titre: string | null; lignes: LigneEtat[] }[] = [];
  for (const l of lignes) {
    const courant = groupes.at(-1);
    if (!courant || l.groupe) groupes.push({ titre: l.groupe ?? null, lignes: [l] });
    else courant.lignes.push(l);
  }
  return groupes;
}

export const MENTION_SYSCOHADA =
  "Codes de postes SYSCOHADA révisé indicatifs, à confirmer par un expert-comptable avant tout usage normé. États simplifiés : amortissement linéaire en année pleine, impôt payé dans l'exercice, sans opérations hors activités ordinaires, cessions ni provisions.";

export const MENTION_RATIOS =
  "« — » : valeur non définie (par exemple capitaux propres négatifs, capacité d'autofinancement nulle ou absence de dette).";

// --- Synthèse et scénarios --------------------------------------------------------------------

export interface LigneScenario {
  cle: string;
  libelle: string;
  valeurs: Record<NomScenario, string>;
}

/** Les trois scénarios côte à côte (synthèse du moteur), valeurs déjà mises en forme. */
export function lignesScenarios(
  synthese: readonly SyntheseScenario[],
  devise: Devise,
): LigneScenario[] {
  const par = (s: NomScenario) => synthese.find((x) => x.scenario === s);
  const ligne = (
    cle: string,
    libelle: string,
    lire: (s: SyntheseScenario) => string,
  ): LigneScenario => ({
    cle,
    libelle,
    valeurs: Object.fromEntries(
      SCENARIOS.map((s) => {
        const x = par(s);
        return [s, x ? lire(x) : VALEUR_ABSENTE];
      }),
    ) as Record<NomScenario, string>,
  });
  const m = (v: number) => formaterMontantMineur(v, devise);
  return [
    ligne("ca_final", "Chiffre d'affaires de la dernière année", (s) => m(s.chiffreAffairesFinal)),
    ligne("resultat_cumule", "Résultat net cumulé", (s) => m(s.resultatNetCumule)),
    ligne("tresorerie_finale", "Trésorerie nette finale", (s) => m(s.tresorerieFinale)),
    ligne("van", "Valeur actuelle nette des flux libres", (s) => m(s.valeurActuelleNette)),
    ligne("tri", "Taux de rendement interne", (s) =>
      s.tauxRendementInterne === null
        ? "Non défini"
        : formaterPourcentage(s.tauxRendementInterne, 1),
    ),
    ligne("alertes", "Alertes", (s) =>
      s.nombreAlertes === 0
        ? "Aucune"
        : `${formaterNombre(s.nombreAlertes, 0)} alerte${s.nombreAlertes > 1 ? "s" : ""}`,
    ),
  ];
}

const LIBELLES_ECARTS: Record<keyof EcartsScenario, (v: string) => string> = {
  croissanceChiffreAffaires: (v) => `croissance du chiffre d'affaires ${v} pts`,
  tauxMargeBrute: (v) => `marge brute ${v} pts`,
  tauxChargesVariables: (v) => `charges variables ${v} pts`,
  chargesFixes: (v) => `charges fixes ${v} %`,
  delaiClientsJours: (v) => `délai clients ${v} jours`,
};

/** « croissance du chiffre d'affaires +5 pts ; marge brute +2 pts ; charges fixes −5 % ». */
export function descriptionEcarts(e: EcartsScenario | undefined): string {
  const parties = (Object.keys(LIBELLES_ECARTS) as (keyof EcartsScenario)[])
    .filter((k) => typeof e?.[k] === "number" && e[k] !== 0)
    .map((k) => LIBELLES_ECARTS[k](formaterSigne(e?.[k] as number)));
  return parties.length === 0
    ? "Aucun écart : identique au scénario de base."
    : parties.join(" ; ");
}

/** Indicateurs clés du scénario de base (synthèse du moteur), libellé et valeur mise en forme. */
export function indicateursCles(s: SyntheseResultat, devise: Devise): [string, string][] {
  const m = (v: number) => formaterValeur("montant", v, devise);
  return [
    ["Chiffre d'affaires de la dernière année", m(s.chiffreAffairesFinal)],
    ["Résultat net cumulé", m(s.resultatNetCumule)],
    ["Capacité d'autofinancement cumulée", m(s.capaciteAutofinancementCumulee)],
    ["Trésorerie nette finale", m(s.tresorerieFinale)],
    [
      `Valeur actuelle nette des flux libres (taux ${formaterPoints(s.tauxActualisation)})`,
      m(s.valeurActuelleNette),
    ],
    [
      "Taux de rendement interne des flux libres",
      s.tauxRendementInterne === null
        ? "Non défini"
        : formaterValeur("pourcentage", s.tauxRendementInterne, devise),
    ],
  ];
}

// --- Alertes ----------------------------------------------------------------------------------

export const ALERTES_PLAN: Record<CodeAlertePlan, { libelle: string; explication: string }> = {
  TRESORERIE_NEGATIVE: {
    libelle: "Trésorerie négative",
    explication:
      "La trésorerie nette de clôture est négative : un financement complémentaire (apport, emprunt, découvert négocié) est à prévoir.",
  },
  CAPITAUX_PROPRES_NEGATIFS: {
    libelle: "Capitaux propres négatifs",
    explication: "Les pertes cumulées dépassent les apports : la situation nette est négative.",
  },
  CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL: {
    libelle: "Capitaux propres inférieurs à la moitié du capital social",
    explication:
      "Seuil de l'Acte uniforme OHADA : les associés doivent être consultés sur la poursuite de l'activité.",
  },
  BILAN_DESEQUILIBRE: {
    libelle: "Bilan déséquilibré",
    explication:
      "Actif et passif diffèrent : anomalie du moteur. Ne diffusez pas ce résultat et prévenez le support.",
  },
};

export const GRAVITE_LIBELLES: Record<AlertePlan["gravite"], string> = {
  critique: "Critique",
  attention: "Attention",
};

export function libelleAlerte(code: string): string {
  return ALERTES_PLAN[code as CodeAlertePlan]?.libelle ?? "Alerte du modèle";
}

/** « Critique — Trésorerie négative en 2028 (année 2) : −1 200 000 FCFA, seuil 0 FCFA. » */
export function texteAlerte(a: AlertePlan, devise: Devise): string {
  const gravite = GRAVITE_LIBELLES[a.gravite] ?? "Alerte";
  return `${gravite} — ${libelleAlerte(a.code)} en ${a.exercice} (année ${a.annee}) : ${formaterMontantMineur(a.montant, devise)}, seuil ${formaterMontantMineur(a.seuil, devise)}.`;
}

/** Alertes de chaque scénario, base d'abord (les scénarios sans alerte sont omis). */
export function alertesParScenario(
  r: Pick<ResultatScenarios, NomScenario>,
): { scenario: NomScenario; alertes: AlertePlan[] }[] {
  return SCENARIOS.map((s) => ({ scenario: s, alertes: r[s]?.alertes ?? [] })).filter(
    (x) => x.alertes.length > 0,
  );
}

/** « Scénario base : 2 alertes, dont des alertes critiques ». */
export function titreAlertesScenario(
  scenario: NomScenario,
  alertes: readonly AlertePlan[],
): string {
  const n = alertes.length;
  const critique = alertes.some((a) => a.gravite === "critique");
  return `Scénario ${SCENARIO_LIBELLES[scenario].toLowerCase()} : ${n} alerte${n > 1 ? "s" : ""}${critique ? ", dont des alertes critiques" : ""}`;
}

/** Années de trésorerie négative d'un scénario (d'après ses alertes, pas d'un calcul). */
export function exercicesTresorerieNegative(r: Pick<ResultatPlan, "alertes">): number[] {
  return r.alertes.filter((a) => a.code === "TRESORERIE_NEGATIVE").map((a) => a.exercice);
}

/** Résumé annoncé après une simulation ou affiché sur une version. */
export function resumeAlertes(r: Pick<ResultatScenarios, NomScenario>): string {
  const base = r.base.alertes.length;
  const critiques = r.base.alertes.filter((a) => a.gravite === "critique").length;
  if (base === 0) return "Aucune alerte dans le scénario de base.";
  const s = base > 1 ? "s" : "";
  return `${base} alerte${s} dans le scénario de base, dont ${critiques} critique${critiques > 1 ? "s" : ""}.`;
}

// --- Versions, validation ---------------------------------------------------------------------

export function libelleVersionModele(
  v: Pick<ResumeModele, "version" | "auteur_nom" | "calcule_le">,
) {
  return `Version ${v.version} · calculée le ${formaterDateHeure(v.calcule_le)} par ${v.auteur_nom}`;
}

export function libelleValidationModele(v: Pick<ResumeModele, "validation">): string {
  if (!v.validation) return "Non validée";
  const qui = v.validation.valideur_nom ?? "un responsable";
  return `Validée par ${qui} le ${formaterDate(v.validation.valide_le, "Africa/Abidjan")}`;
}

/** Annonce affichée au retour d'un enregistrement (`?enregistree=1`). */
export function messageVersionEnregistree(version: number, partageRetire: boolean): string {
  const base = `Version ${version} enregistrée : résultat calculé par le moteur, figé et horodaté. Elle doit être validée par un responsable de la mission, autre que son auteur.`;
  return partageRetire
    ? `${base} Le partage au client a été retiré : faites tout valider, puis partagez de nouveau.`
    : base;
}

/** Le plafond de versions est atteint : une nouvelle version serait refusée (409). */
export const plafondAtteint = (derniere: number | null | undefined) =>
  typeof derniere === "number" && derniere >= VERSIONS_MODELE_MAX;

export const MESSAGE_PLAFOND = `Ce plan a atteint ${VERSIONS_MODELE_MAX} versions du modèle financier : aucune nouvelle version ne peut être enregistrée. La simulation reste possible ; pour repartir de zéro, créez un nouveau plan.`;

// --- Comparaison ------------------------------------------------------------------------------

const LIBELLES_HYPOTHESES: Record<string, string> = {
  premierExercice: "Premier exercice prévisionnel",
  chiffreAffairesReference: "Chiffre d'affaires de référence",
  croissanceChiffreAffaires: "Croissance du chiffre d'affaires",
  tauxMargeBrute: "Taux de marge brute",
  tauxChargesVariables: "Charges externes variables",
  chargesFixes: "Charges externes fixes",
  effectifs: "Effectifs",
  investissements: "Investissements",
  emprunts: "Emprunts",
  augmentationsCapital: "Augmentations de capital",
  delaiClientsJours: "Délai de paiement des clients",
  delaiFournisseursJours: "Délai de paiement des fournisseurs",
  stocksJours: "Rotation des stocks",
  tauxImpotSocietes: "Taux d'impôt sur les sociétés",
  tauxDistributionDividendes: "Taux de distribution des dividendes",
  tauxActualisation: "Taux d'actualisation",
  bilanOuverture: "Bilan d'ouverture",
  horizon: "Horizon",
  devise: "Devise",
  flux: "Flux",
};

const LIBELLES_SOUS_CHAMPS: Record<string, string> = {
  libelle: "libellé",
  effectifs: "effectifs (équivalents temps plein)",
  salaireAnnuelBrut: "salaire annuel brut",
  tauxChargesSociales: "taux de charges sociales",
  revalorisationAnnuelle: "revalorisation annuelle",
  annee: "année",
  montant: "montant",
  dureeAmortissement: "durée d'amortissement",
  anneeDeblocage: "année de déblocage",
  tauxAnnuel: "taux annuel",
  duree: "durée",
  differe: "différé",
  mode: "mode de remboursement",
  immobilisationsNettes: "immobilisations nettes",
  dureeResiduelleImmobilisations: "durée résiduelle des immobilisations",
  stocks: "stocks",
  creancesClients: "créances clients",
  tresorerie: "trésorerie",
  capital: "capital",
  reserves: "réserves",
  dettesFournisseurs: "dettes fournisseurs",
  deficitsReportables: "déficits reportables",
  croissanceChiffreAffaires: "croissance du chiffre d'affaires",
  tauxMargeBrute: "taux de marge brute",
  tauxChargesVariables: "charges variables",
  chargesFixes: "charges fixes",
  delaiClientsJours: "délai clients",
};

const ELEMENTS_LISTE: Record<string, string> = {
  effectifs: "catégorie",
  investissements: "investissement",
  emprunts: "emprunt",
  augmentationsCapital: "augmentation",
  flux: "année",
};

const SEGMENT = /^([A-Za-z]+)(?:\[(\d+)\])?$/;

function rang(index: string | undefined): number | null {
  return index === undefined ? null : Number(index) + 1;
}

/** Chemin d'hypothèse du moteur → libellé français (« effectifs[0].tauxChargesSociales »). */
export function libelleChemin(chemin: string): string {
  const segments = chemin.split(".").filter((s) => s !== "");
  if (segments[0] === "ecarts") segments.shift();
  const scenario = segments[0];
  if (scenario === "optimiste" || scenario === "pessimiste") {
    const champ = segments[1] ? (LIBELLES_SOUS_CHAMPS[segments[1]] ?? segments[1]) : null;
    return `Scénario ${scenario}${champ ? ` : écart de ${champ}` : ""}`;
  }
  const premier = SEGMENT.exec(segments[0] ?? "");
  if (!premier || !premier[1] || !LIBELLES_HYPOTHESES[premier[1]]) return chemin;
  const cle = premier[1];
  const n = rang(premier[2]);
  let texte = LIBELLES_HYPOTHESES[cle] as string;
  if (n !== null) {
    texte += ELEMENTS_LISTE[cle] ? `, ${ELEMENTS_LISTE[cle]} ${n}` : `, année ${n}`;
  }
  const second = SEGMENT.exec(segments[1] ?? "");
  if (second && second[1]) {
    texte += ` : ${LIBELLES_SOUS_CHAMPS[second[1]] ?? second[1]}`;
    const m = rang(second[2]);
    if (m !== null) texte += `, année ${m}`;
  }
  return texte;
}

const JETON_CHEMIN =
  /\b(?:ecarts\.)?(?:optimiste\.|pessimiste\.)?[a-z][A-Za-z]*(?:\[\d+\])?(?:\.[a-z][A-Za-z]*(?:\[\d+\])?)*/g;

/** Remplace les chemins d'hypothèses cités par le moteur par leur libellé français. */
export function traduireMessageMoteur(message: string): string {
  return message.replace(JETON_CHEMIN, (jeton) => {
    const technique = /[A-Z[.]/.test(jeton);
    const libelle = libelleChemin(jeton);
    return technique && libelle !== jeton ? `« ${libelle} »` : jeton;
  });
}

/** Rangées d'une série comparée : exercice (ou « 2027 / 2028 » si les exercices diffèrent). */
export function lignesSerieComparee(
  s: SerieComparee,
  devise: Devise,
): { exercice: string; de: string; a: string }[] {
  const n = Math.max(s.de.length, s.a.length);
  return Array.from({ length: n }, (_, i) => {
    const d = s.de[i];
    const x = s.a[i];
    const exercice =
      d && x && d.exercice !== x.exercice
        ? `${d.exercice} / ${x.exercice}`
        : String(d?.exercice ?? x?.exercice ?? "");
    return {
      exercice,
      de: formaterMontantMineur(d?.valeur, devise),
      a: formaterMontantMineur(x?.valeur, devise),
    };
  });
}

/** Numéro de version lu dans l'URL (`?version=3`) ; null si absent ou invalide. */
export function lireNumeroVersionModele(v: string | string[] | undefined): number | null {
  const brut = Array.isArray(v) ? v[0] : v;
  if (typeof brut !== "string" || !/^[1-9]\d{0,5}$/.test(brut)) return null;
  const n = Number(brut);
  return n <= 100000 ? n : null;
}

/** Paramètres « ?de=&a= » d'une comparaison : null si absents, erreur si invalides. */
export function lireComparaison(
  de: string | string[] | undefined,
  a: string | string[] | undefined,
): { de: number; a: number } | { erreur: string } | null {
  const lire = (v: string | string[] | undefined) => {
    const brut = Array.isArray(v) ? v[0] : v;
    return typeof brut === "string" && /^[1-9]\d{0,5}$/.test(brut) && Number(brut) <= 100000
      ? Number(brut)
      : null;
  };
  const brutDe = Array.isArray(de) ? de[0] : de;
  const brutA = Array.isArray(a) ? a[0] : a;
  if ((brutDe === undefined || brutDe === "") && (brutA === undefined || brutA === "")) return null;
  const x = lire(de);
  const y = lire(a);
  if (x === null || y === null) {
    return { erreur: "Indiquez deux numéros de version (nombres entiers à partir de 1)." };
  }
  if (x === y) return { erreur: "Choisissez deux versions différentes à comparer." };
  return { de: x, a: y };
}

// --- ROI --------------------------------------------------------------------------------------

/** Note sur le taux d'actualisation retenu pour le ROI (version du modèle ou valeur de départ). */
export function noteTauxRoi(
  r: Pick<RoiPlan, "taux_actualisation" | "source_taux" | "modele_version">,
) {
  const taux = formaterPoints(r.taux_actualisation);
  return r.source_taux === "modele" && r.modele_version !== null
    ? `VAN au taux d'actualisation de la version ${r.modele_version} du modèle financier (${taux}) ; flux de l'année 0 (budget) non actualisé.`
    : `Aucun modèle financier : VAN au taux d'actualisation de départ du moteur (${taux}), à confirmer par un expert ; flux de l'année 0 (budget) non actualisé.`;
}

// --- Messages d'erreur ------------------------------------------------------------------------

const CODES_MOTEUR: Record<string, string> = {
  HORIZON_INVALIDE: "Horizon refusé par le moteur de calcul.",
  HYPOTHESE_INVALIDE: "Hypothèse refusée par le moteur de calcul.",
  MONTANT_INVALIDE: "Montant refusé par le moteur de calcul.",
  INVESTISSEMENT_INVALIDE: "Investissement refusé par le moteur de calcul.",
  EMPRUNT_INVALIDE: "Emprunt refusé par le moteur de calcul.",
  BILAN_OUVERTURE_DESEQUILIBRE: "Bilan d'ouverture déséquilibré.",
  FLUX_INVALIDES: "Flux refusés par le moteur de calcul.",
};

export const MESSAGE_INTROUVABLE_MODELE =
  "Ce plan ou cette version du modèle n'est plus accessible. Actualisez la page.";

/** Message français d'une erreur du modèle financier (400 du moteur, 403, 404, 409…). */
export function messageModele(e: unknown): string {
  if (e instanceof ErreurApi) {
    const titre = CODES_MOTEUR[e.code];
    if (titre) return `${titre} ${traduireMessageMoteur(e.message)}`;
    if (e.code === "PLAN_PLAFOND_VERSIONS") return MESSAGE_PLAFOND;
    if (e.code === "VALIDATION_REQUISE") return `Séparation des tâches : ${e.message}`;
    if (e.code === "CONTENU_VALIDE") return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_MODELE;
    if (e.statut === 409) return e.message;
    if (e.statut === 403) {
      return "Votre rôle ne vous permet pas cette action : seul un responsable de la mission (directeur, chef de mission ou associé) valide une version, et seuls les rédacteurs du plan simulent ou enregistrent.";
    }
    if (e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir. */
export const etatModeleChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const cheminSimulation = (planId: string) => `/api/plans/${seg(planId)}/modeles/simulation`;
export const cheminModeles = (planId: string) => `/api/plans/${seg(planId)}/modeles`;

export function cheminListeModeles(planId: string, limite: number, curseur: string | null) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${cheminModeles(planId)}?${q.toString()}`;
}

export const cheminVersionModele = (planId: string, version: number) =>
  `${cheminModeles(planId)}/${version}`;
export const cheminValidationModele = (planId: string, version: number) =>
  `${cheminVersionModele(planId, version)}/validation`;
export const cheminComparaison = (planId: string, de: number, a: number) =>
  `${cheminModeles(planId)}/comparaison?de=${de}&a=${a}`;
export const cheminRoi = (planId: string, version?: number | null) =>
  `/api/plans/${seg(planId)}/initiatives/roi${version ? `?version=${version}` : ""}`;
