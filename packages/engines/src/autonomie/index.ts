/**
 * Moteur des niveaux d'autonomie de l'IA (AGT-03, PRD complémentaire §7.1) :
 * niveau effectif d'une brique, statistiques et éligibilité à la promotion
 * N2 → N3 (décision d'un associé requise), rétrogradation automatique sur
 * incident majeur. Fonctions pures et déterministes, sans horloge.
 */
export { ErreurAutonomie, type CodeErreurAutonomie } from "./erreurs";
export {
  NIVEAUX_AUTONOMIE,
  SEUILS_PROMOTION_AUTONOMIE_DEFAUT,
  NIVEAU_APRES_INCIDENT_MAJEUR,
  estNiveauAutonomie,
  rangNiveauAutonomie,
  niveauEffectif,
  statistiquesAutonomie,
  evaluerPromotion,
  retrogradationAuto,
  type NiveauAutonomie,
  type RaisonNiveauAutonomie,
  type OptionsNiveauEffectif,
  type NiveauEffectif,
  type SeuilsPromotionAutonomie,
  type GraviteIncidentAutonomie,
  type ExecutionBrique,
  type IncidentBrique,
  type StatistiquesAutonomie,
  type RaisonRefusPromotion,
  type EvaluationPromotion,
  type RaisonRetrogradation,
  type Retrogradation,
} from "./niveaux";
