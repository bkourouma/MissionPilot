/**
 * Moteur des appels d'offres (AO-01 à AO-03, AO-08, PRD complémentaire §9) : rapprochement avec
 * le profil du cabinet, score go/no-go, découpage déterministe des exigences et synthèse de la
 * matrice de conformité, rétro-planning et alertes. Fonctions pures ; l'API les appelle, elle ne
 * recalcule rien.
 */
export {
  ErreurAppelsOffres,
  motsSignificatifs,
  normaliserTerme,
  type CodeErreurAppelsOffres,
} from "./commun";
export {
  COMPETENCES_POUR_SCORE_PLEIN,
  POIDS_RAPPROCHEMENT,
  PROFIL_COMPETENCES_MAX,
  PROFIL_REFERENCES_MAX,
  rapprocherAppelOffres,
  REFERENCES_POUR_SCORE_PLEIN,
  type ComposanteRapprochement,
  type FicheRapprochement,
  type ProfilCabinet,
  type Rapprochement,
  type ReferenceCabinet,
} from "./rapprochement";
export {
  CRITERES_GO_NO_GO,
  ELIMINATOIRES_GO_NO_GO,
  evaluerGoNoGo,
  MARGE_BP_MAX,
  MARGE_BP_MIN,
  PARAMETRES_GO_NO_GO_DEFAUT,
  RECOMMANDATIONS_GO_NO_GO,
  type CritereGoNoGo,
  type EliminatoireGoNoGo,
  type EntreesGoNoGo,
  type NoteCritere,
  type ParametresGoNoGo,
  type RecommandationGoNoGo,
  type ResultatGoNoGo,
} from "./go-no-go";
export {
  CATEGORIES_EXIGENCE,
  categorieExigence,
  decouperExigences,
  EXIGENCE_LIBELLE_MAX,
  EXIGENCE_LIBELLE_MIN,
  EXIGENCE_REFERENCE_MAX,
  EXIGENCES_EXTRACTION_MAX,
  STATUTS_CONFORMITE,
  STATUTS_SATISFAISANTS,
  syntheseConformite,
  type CategorieExigence,
  type ExigenceProposee,
  type LigneConformite,
  type StatutConformite,
  type SyntheseConformite,
} from "./exigences";
export {
  alertesAppelsOffres,
  ETAPES_RETROPLANNING_STANDARD,
  niveauAlerteAo,
  NIVEAUX_ALERTE_AO,
  retroPlanning,
  STATUTS_AO_OUVERTS,
  STATUTS_APPEL_OFFRES,
  transitionAppelOffresAutorisee,
  TRANSITIONS_APPEL_OFFRES,
  type AlerteAppelOffres,
  type AppelOffresSuivi,
  type EtapeModele,
  type EtapePlanifiee,
  type EtapeSuivie,
  type NiveauAlerteAo,
  type RetroPlanning,
  type StatutAppelOffres,
} from "./retroplanning";
