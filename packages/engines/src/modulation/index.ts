/**
 * Moteur de modulation des méthodes (STD-04, STD-05, PRD complémentaire §4.3
 * et §4.4) : facteurs de contexte typés, règles déclaratives (conditions
 * combinables, effets typés, priorités), application journalisée, détection
 * des conflits et des cycles, simulation avant activation, cas types et
 * validation d'un jeu de règles. Fonctions pures et déterministes : mêmes
 * entrées ⇒ même sortie, ordre stable ; aucune IA, aucune base, aucune horloge.
 */
export { ErreurModulation, type CodeErreurModulation } from "./erreurs";
export {
  REGLES_MODULATION_MAX,
  EFFETS_PAR_REGLE_MAX,
  PROFONDEUR_CONDITION_MAX,
  NOEUDS_CONDITION_MAX,
  PRIORITE_MODULATION_MAX,
  VALEURS_LISTE_MAX,
  LONGUEUR_CODE_MAX,
  TYPES_FACTEUR_CONTEXTE,
  COMPARATEURS_MODULATION,
  TYPES_CONDITION_MODULATION,
  TYPES_EFFET_MODULATION,
  type TypeFacteurContexte,
  type DefinitionFacteurContexte,
  type ValeurFacteurContexte,
  type ContexteModulation,
  type ComparateurModulation,
  type ValeurComparee,
  type TypeConditionModulation,
  type ConditionModulation,
  type TypeEffetModulation,
  type EffetModulation,
  type RegleModulation,
  type ReferentielModulation,
  type CodeAnomalieModulation,
  type GraviteAnomalieModulation,
  type AnomalieModulation,
} from "./types";
export { comparerValeur, type VerificationCondition } from "./conditions";
export {
  cleEffet,
  signatureEffet,
  type CandidatEffet,
  type EffetApplique,
  type ConflitModulation,
  type EtatModulation,
} from "./effets";
export { dependancesRegles } from "./dependances";
export {
  appliquerModulation,
  type OptionsModulation,
  type EntreeJournalModulation,
  type ResultatModulation,
} from "./application";
export {
  comparerModulations,
  simulerModulation,
  executerCasTypes,
  type EffetModifie,
  type DifferentielModulation,
  type SimulationModulation,
  type AttenduCasType,
  type CasTypeModulation,
  type EcartCasType,
  type ResultatCasType,
  type ExecutionCasTypes,
} from "./simulation";
export {
  validerFacteursContexte,
  validerContexteModulation,
  validerReglesModulation,
  type ValidationModulation,
} from "./validation";
