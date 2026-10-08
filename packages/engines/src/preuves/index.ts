/**
 * Moteur du registre des preuves (PRV-02 à PRV-05, PRD complémentaire §6) :
 * indice de solidité d'une assertion, regroupement des preuves pour et contre
 * et contradictions à arbitrer, carte de triangulation sources × dimensions,
 * contrôle des assertions R2 et R3 sans preuve. Fonctions pures et
 * déterministes ; poids en centièmes entiers, indice en fraction exacte.
 */
export { ErreurPreuves, type CodeErreurPreuves } from "./erreurs";
export {
  TYPES_SOURCE_PREUVE,
  FIABILITES_PREUVE,
  POIDS_FIABILITE_CENTIEMES,
  SENS_PREUVE,
  estTypeSourcePreuve,
  estFiabilitePreuve,
  rangFiabilite,
  type TypeSourcePreuve,
  type FiabilitePreuve,
  type SensPreuve,
  type PreuveAssertion,
} from "./preuve";
export {
  PLAFOND_SOLIDITE_CENTIEMES,
  SEUILS_SOLIDITE_DEFAUT,
  indiceSolidite,
  lectureSolidite,
  type LectureSolidite,
  type SeuilsSolidite,
  type OptionsSolidite,
  type EntreeSolidite,
  type FiabiliteRetenue,
  type SoliditeAssertion,
} from "./solidite";
export {
  regrouperPreuvesAssertion,
  regrouperPreuvesParAssertion,
  contradictionsAArbitrer,
  type PreuvesRegroupees,
  type LienPreuveAssertion,
  type GroupePreuvesAssertion,
} from "./contradictions";
export {
  TYPES_MINIMUM_TRIANGULATION_DEFAUT,
  carteTriangulation,
  type PreuveDimensionnee,
  type OptionsTriangulation,
  type CelluleTriangulation,
  type DimensionTriangulee,
  type ZoneNonCouverte,
  type CarteTriangulation,
} from "./triangulation";
export {
  CLASSE_MIN_CONTROLE_PREUVE,
  detecterAssertionsSansPreuve,
  type AssertionLivrable,
  type CodeAnomaliePreuve,
  type AnomaliePreuve,
  type ControlePreuvesLivrable,
} from "./controle";
