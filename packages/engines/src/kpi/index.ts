/**
 * Moteur de pilotage par KPI (service 4, KPI-01 à KPI-04) : taux d'atteinte
 * selon le sens de lecture, statut vert/orange/rouge (seuils 95 % / 80 %
 * paramétrables), agrégation par période selon la nature (flux, stock),
 * tendance, écart à la cible, projection à la fin de période, score
 * composite pondéré et alertes (dégradation, retard de mesure, seuils).
 * Fonctions pures et déterministes ; arithmétique exacte, ratios et valeurs
 * de sortie arrondis à 4 décimales. Aucun LLM, aucun accès à la base.
 */
export { ErreurKpi, type CodeErreurKpi } from "./erreurs";
export {
  SEUILS_STATUT_KPI_DEFAUT,
  tauxAtteinteKpi,
  statutKpiDepuisTaux,
  rangStatutKpi,
  ecartCibleKpi,
  evaluerKpi,
  type SensLectureKpi,
  type StatutKpi,
  type StatutKpiMesure,
  type SeuilsStatutKpi,
  type OptionsAtteinteKpi,
  type AtteinteKpi,
  type EcartCibleKpi,
  type OptionsEvaluationKpi,
  type EntreeEvaluationKpi,
  type EvaluationKpi,
} from "./atteinte";
export {
  MAX_PERIODES_KPI,
  periodeKpiDe,
  periodeKpiDepuisRang,
  periodeKpiSuivante,
  periodeKpiPrecedente,
  periodesKpiEntre,
  joursDansPeriodeKpi,
  type FrequenceKpi,
  type PeriodeKpi,
} from "./periodes";
export {
  agregationKpiParDefaut,
  agregerKpiParPeriode,
  type NatureKpi,
  type ModeAgregationKpi,
  type MesureKpi,
  type OptionsAgregationKpi,
  type ValeurPeriodeKpi,
} from "./agregation";
export {
  TOLERANCE_TENDANCE_KPI_DEFAUT,
  tendanceKpi,
  type DirectionKpi,
  type EvolutionKpi,
  type OptionsTendanceKpi,
  type TendanceKpi,
} from "./tendance";
export {
  projeterKpiFinPeriode,
  type OptionsProjectionKpi,
  type MethodeProjectionKpi,
  type ProjectionKpi,
} from "./projection";
export {
  BORNES_SCORE_KPI_DEFAUT,
  scoreCompositeKpi,
  type KpiPondere,
  type OptionsScoreKpi,
  type ContributionKpi,
  type KpiExclu,
  type ScoreCompositeKpi,
} from "./score";
export {
  PERIODES_DEGRADATION_KPI_DEFAUT,
  DELAI_GRACE_KPI_DEFAUT_JOURS,
  degradationsConsecutivesKpi,
  alerteDegradationKpi,
  alerteRetardKpi,
  alertesSeuilsKpi,
  type AlerteKpi,
  type OptionsDegradationKpi,
  type EntreeRetardKpi,
  type SeuilsAlerteKpi,
} from "./alertes";
export {
  MAX_NOEUDS_ARBRE_KPI,
  MAX_PROFONDEUR_ARBRE_KPI,
  decomposerArbreKpi,
  type RelationArbreKpi,
  type NoeudArbreKpi,
  type OptionsArbreKpi,
  type NoeudResultatKpi,
  type LevierKpi,
  type ResultatArbreKpi,
} from "./arbre";
export {
  cleIncoherenceUniteKpi,
  exigerUnitesCoherentesKpi,
  messageUniteIncoherenteKpi,
  normaliserUniteKpi,
  unitesIncoherentesArbreKpi,
  type IncoherenceUniteKpi,
  type NoeudUniteKpi,
} from "./arbre-unites";
export {
  PERIODES_RETARD_NUL_KPI,
  FENETRE_COMPLETUDE_KPI,
  K_ABERRANT_KPI,
  MESURES_MIN_ABERRANTES_KPI,
  SEUIL_CORRECTIONS_FREQUENTES_KPI,
  DELAI_GRACE_MAX_JOURS_QUALITE_KPI,
  POIDS_QUALITE_KPI,
  SEUILS_QUALITE_KPI,
  evaluerQualiteDonneesKpi,
  type NiveauQualiteKpi,
  type MotifQualiteKpi,
  type EntreeQualiteKpi,
  type QualiteKpi,
} from "./qualite-donnees";
export {
  FENETRE_EFFICACITE_KPI_DEFAUT,
  MINIMUM_PAR_COTE_KPI_DEFAUT,
  selectionnerPeriodesAvantApres,
  mesurerEfficaciteActionKpi,
  type VerdictEfficaciteKpi,
  type PeriodeValeurKpi,
  type SelectionAvantApresKpi,
  type OptionsEfficaciteKpi,
  type EfficaciteKpi,
} from "./efficacite";
export {
  MAX_POINTS_REVUE_KPI,
  composerOrdreDuJourKpi,
  type CodePointRevueKpi,
  type KpiRevueKpi,
  type ActionRevueKpi,
  type DecisionRevueKpi,
  type PointRevueKpi,
  type OrdreDuJourKpi,
} from "./revue";
