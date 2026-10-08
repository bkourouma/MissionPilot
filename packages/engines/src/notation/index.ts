/**
 * Moteur de notation (service 1, NOT-01 à NOT-08) : grille pondérée par
 * secteur, conversion des réponses en points, scores par dimension et global
 * sur 100, classes A–E, moyenne multi-répondants, ajustement motivé et tracé,
 * comparaison avant/après et données du rapport. Fonctions pures et
 * déterministes ; arithmétique exacte, arrondi final à 1 décimale.
 */
export { ErreurNotation, type CodeErreurNotation, type AnomalieGrille } from "./erreurs";
export {
  validerGrille,
  exigerGrilleValide,
  poidsNormalises,
  verifierCoherence,
  exigerCoherence,
  type PointsOption,
  type RegleConversion,
  type IndicateurGrille,
  type DimensionGrille,
  type SurchargeSecteur,
  type GrilleNotation,
} from "./grille";
export {
  appliquerPonderationsContexte,
  type PonderationContexte,
  type PonderationAppliquee,
} from "./ponderations-contexte";
export { BAREME_CLASSES, classe, rangClasse, type Classe } from "./classes";
export { scoreQuestion } from "./conversion";
export {
  STRATEGIE_DEFAUT,
  COUVERTURE_MINIMALE_DEFAUT,
  COUVERTURE_GLOBALE_MINIMALE_DEFAUT,
  scoreDimension,
  scoreGlobal,
  type StrategieManquantes,
  type OptionsNotation,
  type StatutIndicateur,
  type DetailIndicateur,
  type ResultatDimension,
  type DimensionNotee,
  type ResultatNotation,
} from "./score";
export {
  noterRepondants,
  preparerReponses,
  noterQuestionnaire,
  type ReponsesNotation,
  type OptionsRepondants,
} from "./repondants";
export {
  initialiserAjustements,
  appliquerAjustement,
  type Ajustement,
  type AjustementTrace,
  type DimensionAjustee,
  type ScoreAjuste,
} from "./ajustement";
export {
  SEUIL_FORCE_DEFAUT,
  SEUIL_FAIBLESSE_DEFAUT,
  comparerNotations,
  forcesEtFaiblesses,
  donneesRapport,
  type VueDimension,
  type VueScores,
  type Evolution,
  type EcartScore,
  type ComparaisonNotations,
  type SeuilsForcesFaiblesses,
  type DimensionClassee,
  type BarreDimension,
  type DonneesRapport,
} from "./rapport";
// Notation augmentée (PRD complémentaire §11.1 : NOT-09 à NOT-13, NOT-17).
export {
  ErreurNotationAugmentee,
  type CodeErreurNotationAugmentee,
  type AnomalieNotationAugmentee,
} from "./augmentee-erreurs";
export {
  PUBLICS_ITEM,
  PRIORITE_ITEM_MAX,
  DUREE_ITEM_MIN_SECONDES,
  DUREE_ITEM_MAX_SECONDES,
  FORMULATION_LONGUEUR_MAX,
  ANCRAGE_LONGUEUR_MAX,
  AIDE_LONGUEUR_MAX,
  validerItemBanque,
  exigerItemValide,
  formulationPour,
  dureeSelection,
  selectionnerItems,
  controlerProposition,
  definitionDepuisSelection,
  type PublicItem,
  type AncrageNiveau,
  type FormulationItem,
  type EtalonnageItem,
  type ItemBanque,
  type ReglesSelection,
  type ItemSelectionne,
  type RaisonEcart,
  type SelectionAdaptative,
  type PropositionItem,
} from "./banque";
export {
  SEUIL_CONSTAT_MAJEUR_DEFAUT,
  POPULATION_NON_PRECISEE,
  constatsPerception,
  type PopulationRepondant,
  type TypeConstat,
  type GraviteConstat,
  type ConstatPerception,
} from "./constats";
export {
  SEUIL_CONFIANCE_DEFAUT,
  REPONDANTS_CIBLE_DEFAUT,
  SEUIL_CONFIANCE_ELEVEE,
  POIDS_CONFIANCE_DEFAUT,
  indiceConfiance,
  type NiveauConfiance,
  type SoliditeDimension,
  type EntreeConfiance,
  type OptionsConfiance,
  type IndiceConfiance,
} from "./confiance";
export {
  expliquerNote,
  simulerPassage,
  pointsMaximaux,
  palierSuivant,
  type ContributionPratique,
  type ContributionDimension,
  type ExplicationNote,
  type EtapeSimulation,
  type SimulationPassage,
} from "./explication";
export {
  mesurerCalibration,
  type CotationCas,
  type OptionsCalibration,
  type MesureCas,
  type MesureEvaluateur,
  type MesureCalibration,
} from "./calibration";
export {
  prioriserInitiatives,
  type ImpactObserve,
  type InitiativeType,
  type ContextePlan,
  type OptionsPlan,
  type SourceImpact,
  type InitiativePriorisee,
  type PlanActionPriorise,
} from "./plan-action";
