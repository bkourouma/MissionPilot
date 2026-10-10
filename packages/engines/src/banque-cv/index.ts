/**
 * Banque de CV des appels d'offres (AO-04) : années d'expérience et contrôle déterministe des
 * exigences (années, secteurs, diplôme, langues, bailleurs).
 */
export {
  anneesDansSecteur,
  anneesExperience,
  controlerCv,
  ErreurCv,
  moisExperience,
  NIVEAUX_DIPLOME,
  NIVEAUX_LANGUE,
  normaliserLibelle,
  rangMois,
  type CodeCritere,
  type CodeErreurCv,
  type ContenuCvControle,
  type CritereControle,
  type DiplomeCv,
  type ExigencesCv,
  type ExperienceCv,
  type LangueCv,
  type NiveauDiplome,
  type NiveauLangue,
  type ResultatControleCv,
} from "./cv";
