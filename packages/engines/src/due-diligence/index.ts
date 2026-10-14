/**
 * Moteurs du service #2 « Due diligence » (SPEC-3b, ADR-012) : dimensionnement de marché, chaîne
 * de valeur, risques, hypothèses et verdicts, signaux, filtrage d'exclusion et revue E&S, plan
 * des 100 jours, contrôle de la note au comité. Fonctions pures, arithmétique entière, aucune IA.
 */
export { ErreurDueDiligence, type CodeErreurDueDiligence } from "./erreurs";
export {
  ANALYSES_DD,
  CATEGORIES_ANALYSE_DD,
  estCategorieAnalyseDd,
  FAMILLES_RISQUE_DD,
  formaterPointsDeBase,
  METHODES_DIMENSIONNEMENT,
  NIVEAUX_ES,
  NIVEAUX_RISQUE_DD,
  rangNiveauEs,
  rangNiveauRisqueDd,
  RECOMMANDATIONS_NOTE,
  STATUTS_ACTION_100J,
  THEMES_ES,
  TYPES_OPERATION_DD,
  VARIANTES_NOTE,
  VERDICTS_DD,
  type AnalyseDd,
  type FamilleRisqueDd,
  type MethodeDimensionnement,
  type NiveauEs,
  type NiveauRisqueDd,
  type RecommandationNote,
  type StatutAction100j,
  type ThemeEs,
  type TypeOperationDd,
  type VarianteNote,
  type VerdictDd,
} from "./vocabulaire";
export {
  AJUSTEMENTS_MAX,
  dimensionnerMarche,
  FACTEUR_AJUSTEMENT_MAX_BP,
  PARAMETRES_ASCENDANT,
  PARAMETRES_DESCENDANT,
  recouperDimensionnements,
  SEUIL_RECOUPEMENT_BP,
  UNITES_PARAMETRE,
  type AjustementDimensionnement,
  type CodeEtageDd,
  type CouvertureSources,
  type EntreeDimensionnement,
  type EtageDd,
  type FourchetteDd,
  type ParametreDimensionnement,
  type RecoupementDd,
  type ResultatDimensionnement,
  type SensibiliteParametre,
  type SourceParametre,
  type UniteParametre,
} from "./dimensionnement";
export {
  syntheseChaineDeValeur,
  TOLERANCE_SOMME_PARTS_BP,
  type CoherenceParts,
  type EtapeChaineEntree,
  type EtapeChaineSynthese,
  type SyntheseChaine,
} from "./chaine-valeur";
export {
  syntheseRisquesDd,
  type FamilleRisqueSynthese,
  type RisqueEntree,
  type SyntheseRisquesDd,
} from "./risques";
export {
  controlerArbreHypotheses,
  HYPOTHESES_PROFONDEUR_MAX,
  indicationVerdict,
  MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT,
  type AssertionDeHypothese,
  type CodeIncoherenceArbre,
  type ControleArbre,
  type EtatNoeudHypothese,
  type IndicationVerdict,
  type NoeudHypothese,
  type ParametresVerdict,
  type RaisonVerdict,
} from "./hypotheses";
export {
  signauxApplicables,
  type ContexteSignaux,
  type SignalApplicable,
  type SignalBibliotheque,
} from "./signaux";
export {
  filtrerExclusions,
  normaliserTexteDd,
  syntheseSocioEnvironnementale,
  touchesBloquantes,
  type CritereTouche,
  type DeclarationsFiltrage,
  type DecisionExclusion,
  type RegleExclusion,
  type ResultatFiltrage,
  type SyntheseEs,
  type ThemeEsEntree,
  type ToucheExclusion,
} from "./exclusions";
export {
  DUREE_PLAN_JOURS,
  planCentJours,
  type ActionCentJours,
  type ActionPlanSynthese,
  type EntreePlanCentJours,
  type PhasePlanDd,
  type SynthesePlanCentJours,
} from "./plan-100-jours";
export {
  controlerNoteComite,
  sectionsDeLaNote,
  type CodeAvertissementNote,
  type CodeBloquantNote,
  type ControleNote,
  type EntreeControleNote,
  type HypotheseNote,
  type SectionNote,
} from "./note";
