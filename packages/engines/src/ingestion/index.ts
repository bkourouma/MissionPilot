/**
 * Moteurs purs d'ingestion de documents (lot 6, ADR-009) : lecture de montants et vérification de
 * source des nombres, préparation et plafonds du texte des pages, lecture déterministe ou relue
 * des états financiers (DOS-03), lectures de document (DD-02, DD-10) et propositions de standard
 * (STD-13). Le texte d'un document est NON FIABLE : aucune action, boucles bornées, aucun accès
 * horloge, réseau ou fichier. Les chiffres viennent du document, jamais du modèle.
 */
export { MOTIFS_REJET_LIGNE, TYPES_ELEMENT_LECTURE, TYPES_ELEMENT_PROPOSITION } from "./types";
export type {
  BriqueProposee,
  ContenuLectureMoteur,
  ContenuPropositionMoteur,
  ElementLectureMoteur,
  ElementPropose,
  EtapeProposee,
  ExtractionEtat,
  LigneEtatExtraite,
  LigneRejetee,
  MotifRejetLigne,
  PageTexte,
  RubriqueProposee,
  TypeElementLecture,
  TypeElementProposition,
} from "./types";
export {
  lireMontantIsole,
  lireMontantsDansTexte,
  montantPresentDansTexte,
  nombresNonRetrouves,
} from "./montants";
export {
  normaliserTextePage,
  preparerTexteModele,
  verifierPlafondsDocument,
  type OptionsTexteModele,
  type PlafondsDocument,
  type TexteModele,
} from "./pages";
export { extraireEtatDepuisTableau, extraireEtatParRegles } from "./etat-regles";
export { forcerRevueEtat, lireLignesEtatIa } from "./etat-ia";
export { contientNonVerifie, lireLecturesIa } from "./lecture";
export {
  contientDonneeFinanciere,
  lirePropositionIa,
  normaliserCodeProposition,
} from "./proposition";
