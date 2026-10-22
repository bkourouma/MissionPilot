/** Modèle financier du plan : types du résultat du moteur, des versions et de la comparaison. */
import type { Devise } from "./format";

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
