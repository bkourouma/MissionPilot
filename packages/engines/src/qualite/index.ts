/**
 * Moteur de qualité (QUA-01, QUA-04, PRD complémentaire §10) : classes de
 * risque R0 à R3, gardes humaines requises par classe et évaluation d'une
 * garde (étapes manquantes, séparation des tâches, quatre yeux). Fonctions
 * pures et déterministes, sans base, sans horloge ni IA.
 */
export { ErreurQualite, type CodeErreurQualite } from "./erreurs";
export {
  CLASSES_RISQUE,
  estClasseRisque,
  rangClasseRisque,
  classeRisqueMax,
  type ClasseRisque,
} from "./classes";
export {
  ETAPES_GARDE,
  gardesRequises,
  evaluerGarde,
  type EtapeGarde,
  type RoleGarde,
  type GardeRequise,
  type ValidationGarde,
  type OptionsGarde,
  type CodeViolationGarde,
  type ViolationGarde,
  type EvaluationGarde,
} from "./gardes";
