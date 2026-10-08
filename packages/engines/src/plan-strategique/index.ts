/**
 * Moteur de planification stratégique et de modèle financier (service 3,
 * PLA-06 et PLA-07) : fonctions pures et déterministes, sans base, sans
 * réseau, sans horloge ni IA. Montants en entiers d'unités mineures (XOF par
 * défaut), arithmétique rationnelle exacte, ratios arrondis à 4 décimales.
 */
export { ErreurPlan, type CodeErreurPlan } from "./erreurs";
export {
  HORIZON_PLAN_DEFAUT,
  HORIZON_PLAN_MIN,
  HORIZON_PLAN_MAX,
  JOURS_PAR_AN_BFR,
  DEVISE_PLAN_DEFAUT,
  TAUX_IMPOT_SOCIETES_DEFAUT,
  TAUX_ACTUALISATION_DEFAUT,
  validerHorizon,
  normaliserHypotheses,
  validerHypotheses,
  type ParAnnee,
  type ModeRemboursement,
  type CategorieEffectif,
  type InvestissementPlan,
  type EmpruntPlan,
  type AugmentationCapital,
  type BilanOuverture,
  type HypothesesPlan,
  type HypothesesNormalisees,
  type CategorieEffectifNormalisee,
  type EmpruntNormalise,
  type BilanOuvertureNormalise,
} from "./hypotheses";
export { echeancierEmprunt, type EcheanceEmprunt, type EcheancierEmprunt } from "./emprunts";
export { valeurActuelleNette, tauxRendementInterne } from "./actualisation";
export {
  detecterAlertesPlan,
  type AlertePlan,
  type CodeAlertePlan,
  type GraviteAlertePlan,
  type ExerciceSurveille,
} from "./alertes";
export {
  calculerPlanFinancier,
  REFERENCES_SYSCOHADA,
  type CompteResultatPrevisionnel,
  type BilanPrevisionnel,
  type FluxTresoreriePrevisionnel,
  type IndicateursExercice,
  type ControleEquilibre,
  type ExercicePrevisionnel,
  type SynthesePlan,
  type ResultatPlanFinancier,
} from "./modele";
export {
  controlerDependances,
  recalerFeuilleDeRoute,
  STATUTS_RECALABLES,
  DEPENDANCES_PAR_INITIATIVE_MAX,
  type StatutInitiativeFeuille,
  type InitiativeFeuilleDeRoute,
  type InitiativeRecalee,
  type ResultatFeuilleDeRoute,
} from "./feuille-de-route";
export {
  comparerResultatsPlan,
  ecartValeurs,
  SERIES_CLES_PLAN,
  type NatureValeurComparee,
  type SerieCleePlan,
  type EcartValeurs,
  type PointCompare,
  type SerieComparee,
  type IndicateurCompare,
  type SyntheseComparee,
  type ComparaisonResultatsPlan,
} from "./comparaison";
export {
  calculerScenariosPlan,
  ECARTS_SCENARIOS_DEFAUT,
  type NomScenario,
  type EcartsScenario,
  type EcartsScenarios,
  type SyntheseScenario,
  type ResultatScenarios,
} from "./scenarios";
