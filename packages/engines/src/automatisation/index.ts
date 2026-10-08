/**
 * Moteur d'automatisation (AUT-01 à AUT-06, PRD complémentaire §8, ADR-006) : contenu typé
 * des événements, conditions typées, gabarits de texte, planification idempotente des
 * actions, garde d'action (coupe-circuits, R2/R3 jamais vers le client, N4 réservé à R0,
 * niveau d'autonomie des agents, droits de l'exécutant), simulation sur des événements
 * passés et détection des événements nés du temps. Fonctions pures, sans base ni IA.
 */
export { ErreurAutomatisation, type CodeErreurAutomatisation } from "./erreurs";
export {
  TYPES_CHAMP_EVENEMENT,
  OPERATEURS_AUTOMATISATION,
  PROFONDEUR_CONDITION_AUTOMATISATION_MAX,
  NOEUDS_CONDITION_AUTOMATISATION_MAX,
  VALEURS_LISTE_AUTOMATISATION_MAX,
  ACTIONS_PAR_AUTOMATISATION_MAX,
  REFUS_GARDE_AUTOMATISATION,
  type TypeChampEvenement,
  type ChampEvenement,
  type ChampsEvenement,
  type ValeurPayload,
  type PayloadEvenement,
  type OperateurAutomatisation,
  type ValeurCompareeAutomatisation,
  type ConditionAutomatisation,
  type DefinitionPlanifiable,
  type MetaAction,
  type ContexteGarde,
  type RefusGardeAutomatisation,
  type DecisionGarde,
} from "./types";
export {
  OPERATEURS_PAR_TYPE,
  valeurAdmise,
  validerConditionAutomatisation,
  evaluerConditionAutomatisation,
  type CodeErreurCondition,
  type ErreurCondition,
} from "./conditions";
export {
  TEXTE_PAYLOAD_MAX,
  validerPayloadEvenement,
  normaliserPayloadEvenement,
  type CodeErreurPayload,
  type ErreurPayload,
} from "./payload";
export { variablesGabarit, variablesInconnues, rendreGabarit } from "./gabarit";
export {
  cleActionAutomatisation,
  planifierExecutionAutomatisation,
  type ActionPlanifiee,
  type PlanExecution,
} from "./planification";
export { garderActionAutomatisation } from "./garde";
export {
  simulerAutomatisation,
  type EvenementSimule,
  type ActionSimulee,
  type DetailSimulation,
  type ResultatSimulation,
  type OptionsSimulation,
} from "./simulation";
export {
  PALIERS_SANS_REPONSE_JOURS,
  joursEcoules,
  palierAtteint,
  serieRougeFinale,
  type PeriodeStatut,
  type SerieRouge,
} from "./detection";
