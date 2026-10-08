/**
 * Moteur de contribution de l'IA (AGT-05) : distance d'édition en mots entre
 * le brouillon IA et le texte validé (coût borné), part du brouillon conservée
 * en pour-cent entier, modification majeure à seuil paramétrable, temps de
 * revue agrégé et synthèse sur plusieurs livrables. Fonctions pures et
 * déterministes.
 */
export { ErreurContribution, type CodeErreurContribution } from "./erreurs";
export {
  MOTS_MAX_CONTRIBUTION,
  CELLULES_MAX_CONTRIBUTION,
  decouperMots,
  distanceEditionMots,
  type OptionsDistance,
  type DistanceEdition,
} from "./distance";
export {
  SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT,
  evaluerModificationMajeure,
  agregerTempsRevue,
  contributionIa,
  syntheseContributionsIa,
  type ModificationMajeure,
  type TempsRevue,
  type OptionsContribution,
  type ContributionIa,
  type SyntheseContributionIa,
} from "./contribution";
