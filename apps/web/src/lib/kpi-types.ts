/**
 * Contrats des réponses de l'API KPI et règles affichées (rappel des décisions, jamais
 * recalculées ici). Voir `kpi.ts`, point d'entrée du module.
 */
import type {
  FrequenceKpiApi,
  NatureKpiApi,
  PerspectiveKpi,
  SensLectureKpiApi,
} from "@missionpilot/shared";

// --- Réponses de l'API ----------------------------------------------------------------------

export type StatutKpi = "vert" | "orange" | "rouge" | "non_mesure" | "sans_cible";
export type DirectionKpi = "hausse" | "baisse" | "stable" | "indeterminee";
export type EvolutionKpi = "amelioration" | "degradation" | "stable" | "indeterminee";
export type MethodeProjectionKpi = "prorata" | "regression" | "reconduction" | "aucune";
export type CodeAlerteKpi =
  "DEGRADATION_CONSECUTIVE" | "MESURE_EN_RETARD" | "SEUIL_HAUT" | "SEUIL_BAS" | "VARIATION";

export interface AtteinteKpiVue {
  /** Taux borné, 4 décimales (0,95 = 95 %). */
  taux: number;
  taux_exact: string;
  taux_brut_exact: string;
  /** « binaire » : cible nulle, atteinte tout ou rien. */
  mode: "relatif" | "binaire";
  borne: "plafond" | "plancher" | null;
}

export interface EcartKpiVue {
  ecart: number;
  ecart_exact: string;
  ecart_relatif: number | null;
  /** Positif = mieux que la cible dans le sens de lecture du KPI. */
  ecart_oriente: number;
  cible_atteinte: boolean;
}

/** Période évaluée (`vuePeriode` de l'API). */
export interface PeriodeKpiVue {
  periode: string;
  debut: string;
  fin: string;
  close: boolean;
  valeur: number | null;
  nombre_mesures: number;
  cible: number | null;
  statut: StatutKpi;
  atteinte: AtteinteKpiVue | null;
  ecart: EcartKpiVue | null;
}

export interface TendanceKpiVue {
  direction: DirectionKpi;
  evolution: EvolutionKpi;
  pente: number | null;
  variation: number | null;
  variation_relative: number | null;
  points: number;
}

export interface ProjectionKpiVue {
  valeur_projetee: number | null;
  valeur_exacte: string | null;
  methode: MethodeProjectionKpi;
  jours_ecoules: number;
  jours_total: number;
}

/** Alerte du moteur (`vueAlerte`), datée par sa période. */
export type AlerteKpiVue =
  | { code: "DEGRADATION_CONSECUTIVE"; periode: string; periodes: number; seuil: number }
  | {
      code: "MESURE_EN_RETARD";
      periode: string;
      periode_attendue: string;
      echeance: string;
      jours_de_retard: number;
      periodes_manquantes: number;
      derniere_periode_due: string;
    }
  | { code: "SEUIL_HAUT" | "SEUIL_BAS"; periode: string; valeur: number; seuil: number }
  | {
      code: "VARIATION";
      periode: string;
      valeur: number;
      precedente: number;
      variation_relative: number | null;
      seuil: number;
    };

export interface ScoreKpiVue {
  score: number | null;
  score_exact: string | null;
  statut: StatutKpi;
  /** Part du poids total effectivement mesurée (0..1). */
  couverture: number;
  contributions: {
    kpi_id: string;
    poids_normalise: number;
    taux: number;
    contribution: number;
    statut: StatutKpi;
  }[];
  exclus: { kpi_id: string; raison: "non_mesure" | "sans_cible" }[];
}

/** Définition d'un KPI (`vueDefinition`). */
export interface DefinitionKpi {
  id: string;
  mission_id: string;
  client_id: string;
  libelle: string;
  description: string | null;
  unite: string;
  perspective: PerspectiveKpi | null;
  sens: SensLectureKpiApi;
  nature: NatureKpiApi;
  frequence: FrequenceKpiApi;
  ponderation: number;
  seuil_vert: number | null;
  seuil_orange: number | null;
  alerte_haut: number | null;
  alerte_bas: number | null;
  alerte_variation: number | null;
  proprietaire_id: string | null;
  debut_suivi: string;
  fin_suivi: string | null;
  rappels_actifs: boolean;
  actif: boolean;
  cible_actuelle: number | null;
  cree_le: string;
  modifie_le: string;
}

export interface PeriodeEnCoursKpi extends PeriodeKpiVue {
  projection: ProjectionKpiVue;
  statut_projete: StatutKpi;
}

/** KPI du tableau de bord : définition et évaluation à la date d'arrêté. */
export interface KpiTableau extends DefinitionKpi {
  date_reference: string;
  statut: StatutKpi;
  derniere_periode: PeriodeKpiVue | null;
  tendance: TendanceKpiVue;
  periode_en_cours: PeriodeEnCoursKpi | null;
  alertes: AlerteKpiVue[];
}

export interface PerspectiveTableau {
  perspective: PerspectiveKpi | null;
  nombre_kpi: number;
  score: ScoreKpiVue | null;
}

/** Réponse de `GET /api/missions/:id/kpi/tableau-de-bord`. */
export interface TableauDeBordKpi {
  mission_id: string;
  date_reference: string;
  score_global: ScoreKpiVue | null;
  perspectives: PerspectiveTableau[];
  kpis: KpiTableau[];
  alertes: (AlerteKpiVue & { kpi_id: string; libelle: string })[];
}

export interface CibleKpiVue {
  version: number;
  valeur: number | null;
  a_partir_de: string;
  motif: string | null;
  cree_par: string;
  cree_le: string;
}

export interface ContributeurKpi {
  id: string;
  nom: string;
  email: string;
}

/** Réponse de `GET /api/kpi/:id` (et des écritures de gestion). */
export interface DetailKpi extends DefinitionKpi {
  cibles: CibleKpiVue[];
  contributeurs: ContributeurKpi[];
}

/** Ligne de l'historique des mesures (`vueMesure`), en ajout seul. */
export interface MesureKpi {
  id: string;
  kpi_id: string;
  date_mesure: string;
  periode: string;
  /** null : ligne d'annulation. */
  valeur: number | null;
  annulation: boolean;
  remplace_id: string | null;
  /** Ni annulée, ni remplacée, et pas une ligne d'annulation. */
  active: boolean;
  motif: string | null;
  commentaire: string | null;
  justificatif: string | null;
  origine: "cabinet" | "portail";
  saisie_par: { id: string; nom: string | null };
  saisie_le: string;
}

export interface PageKpi<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/** Alerte enregistrée (`GET /api/kpi/:id/alertes`), détails en snake_case. */
export interface AlerteEnregistree {
  id: string;
  code: string;
  periode: string;
  details: Record<string, unknown> | null;
  detectee_le: string;
}

/** Réglages du pilotage par KPI du cabinet (`GET /api/kpi/parametres`). */
export interface ParametresKpi {
  rappels_actifs: boolean;
  delai_grace_jours: number;
  periodes_degradation: number;
  valeurs_validees: boolean;
}

export const FORMAT_EXPORT_KPI = "missionpilot.kpi.v1";

/** KPI de l'export versionné (`GET /api/missions/:id/kpi/export`). */
export interface KpiExporte {
  definition: DefinitionKpi;
  cibles: CibleKpiVue[];
  mesures: MesureKpi[];
  mesures_tronquees: boolean;
  statut: StatutKpi;
  tendance: TendanceKpiVue;
  periodes_total: number;
  periodes: PeriodeKpiVue[];
  alertes: AlerteKpiVue[];
}

export interface ExportKpi {
  format: typeof FORMAT_EXPORT_KPI;
  genere_le: string;
  date_reference: string;
  periodes_exportees_max: number;
  mesures_exportees_max: number;
  mission: { id: string; intitule: string | null };
  score_global: ScoreKpiVue | null;
  kpis: KpiExporte[];
}

/** Série par période d'un KPI (`GET /api/missions/:id/kpi/series`, sans audit d'export). */
export interface KpiSerie {
  definition: DefinitionKpi;
  statut: StatutKpi;
  periodes_total: number;
  periodes: PeriodeKpiVue[];
}

export interface SerieKpiMission {
  mission_id: string;
  date_reference: string;
  periodes_max: number;
  kpis: KpiSerie[];
}

// --- Règles affichées (rappel des décisions, jamais recalculées ici) --------------------------

/** Seuils de statut par défaut du moteur (DECISIONS.md, KPI-03) : affichage seulement. */
export const SEUILS_STATUT_DEFAUT = { vert: 0.95, orange: 0.8 } as const;
/** Corrections successives d'une même mesure admises par l'API (migration 0160, MPK07). */
export const MAX_CORRECTIONS_PAR_MESURE = 20;
/** Contributeurs du portail par KPI (schéma partagé). */
export const MAX_CONTRIBUTEURS_KPI = 50;
/** Périodes servies par KPI dans l'export (la série affichée vient de l'export). */
export const PERIODES_EXPORTEES_MAX = 36;
