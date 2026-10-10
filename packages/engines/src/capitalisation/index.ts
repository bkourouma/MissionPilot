/**
 * Moteur de capitalisation (PRD complémentaire §12) : écarts du retour d'expérience (CAP-01),
 * base d'estimation par brique et par contexte (CAP-02), analyse des dérogations (CAP-05),
 * matrice de compétences (CAP-06). Fonctions pures, arithmétique entière.
 */
export { ErreurCapitalisation, type CodeErreurCapitalisation } from "./erreurs";
export {
  centiemesDepuisJours,
  formaterCentiemesJours,
  centiemesEnJours,
  sommeCentiemes,
  tempsParBrique,
  type LigneBudgetTache,
  type LigneTempsTache,
  type TempsBrique,
} from "./temps";
export { quartileEntier, resumeRobuste, type ResumeRobuste } from "./statistiques";
export {
  EFFECTIF_MINIMUM_PAR_DEFAUT,
  EFFECTIF_MINIMUM_PLANCHER,
  EFFECTIF_STATISTIQUES_DETAILLEES,
  estimerBriques,
  verifieContexteEstimation,
  type DemandeEstimation,
  type EstimationBrique,
  type NiveauEstimation,
  type ObservationTemps,
  type ResumeEstimation,
  type ValeurContexteObservee,
} from "./estimation";
export {
  ecartPourMille,
  ecartsRetour,
  formaterPourMille,
  pourCentDepuisPourMille,
  SEUIL_ECART_POUR_MILLE_PAR_DEFAUT,
  type BriqueRetour,
  type EcartBrique,
  type EcartsRetour,
  type ReferenceEcart,
} from "./retour";
export {
  analyserDerogations,
  cleGroupeDerogations,
  motsDuMotif,
  motifsSemblables,
  SEUIL_MISSIONS_PAR_DEFAUT,
  SIMILARITE_MOTIFS_POUR_CENT,
  type DerogationObservee,
  type GroupeDerogations,
  type GroupeMotifs,
  type MotCle,
} from "./derogations";
export {
  estNiveauCompetence,
  matriceCompetences,
  NIVEAUX_COMPETENCE,
  type CelluleCompetence,
  type DecisionCompetence,
  type DeclarationCompetence,
  type LigneMatrice,
  type NiveauCompetence,
  type PreuveUsage,
} from "./competences";
