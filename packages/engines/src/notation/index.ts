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
