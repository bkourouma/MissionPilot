/**
 * Moteur de l'activité de démonstration automatique (job « activite_demo », DECISIONS « Activité de
 * démonstration automatique », 2026-11-01) : semaines et fenêtres, feuilles de temps, mission en
 * dérive, ordre de facturation et d'encaissement, avenant mensuel de prolongation. Pur, sans
 * entrée-sortie ni horloge ni hasard : dates `AAAA-MM-JJ`, quantités en centièmes entiers.
 */
export { PARAMETRES_ACTIVITE_DEMO, type ParametresActiviteDemo } from "./parametres";
export {
  estLundiDuMoisDemo,
  fenetreDuMoisDemo,
  jourEvenementDemo,
  libelleMoisDemo,
  libelleSemaineDemo,
  lundisDuMoisDemo,
  lundisRestantsDemo,
  moisDeDateDemo,
  semainesAGenererDemo,
} from "./semaines";
export {
  appliquerPlanFeuilleDemo,
  capaciteRestanteTacheDemo,
  planifierFeuilleDemo,
  type AffectationSemaineDemo,
  type DisponibiliteDemo,
  type EntreeFeuilleDemo,
  type LigneFeuilleDemo,
  type PlanFeuilleDemo,
  type QuantiteTacheDemo,
  type TacheCapaciteDemo,
} from "./feuille";
export {
  ajusterDeriveDemo,
  atterrissageDemo,
  choisirMissionDeriveDemo,
  choisirPorteuseDemo,
  type AjustementDeriveDemo,
  type AtterrissageDemo,
  type MissionDeriveDemo,
  type PorteuseDemo,
  type TacheDeriveDemo,
} from "./derive";
export {
  choisirFactureASolderDemo,
  dateEmissionAdmissibleDemo,
  ordonnerSourcesFactureDemo,
  type FactureOuverteDemo,
  type SourceEcheanceDemo,
  type SourceFactureDemo,
  type SourceRegieDemo,
} from "./facturation";
export {
  LIBELLE_PHASE_PROLONGATION_DEMO,
  besoinMembreDemo,
  choisirAvenantsDemo,
  decoupageCoherentDemo,
  joursOuvresDemo,
  libelleTacheProlongationDemo,
  motifAvenantDemo,
  repartirEcheancesDemo,
  type AvenantDemo,
  type BesoinMembreDemo,
  type CandidatSocleDemo,
  type EntreeBesoinDemo,
  type MembreAvenantDemo,
} from "./prolongation";
