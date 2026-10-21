/**
 * Moteur du brief quotidien (AUT-07, PRD complémentaire §8.3) : gravité, ordre, bornage et
 * composition des éléments « à décider », « qui dérivent » et « prêts à envoyer ». Pur, sans
 * entrée-sortie ; la date de référence est un paramètre.
 */
export { composerBrief, comparerElementsBrief } from "./composition";
export {
  GRAVITE_PLANCHER_BRIEF,
  graviteSelonSeuils,
  LIBELLES_TYPE_BRIEF,
  LIMITE_PAR_FAMILLE_BRIEF,
  LIMITE_PAR_FAMILLE_BRIEF_MAX,
  MOTIFS_VOYANT_BRIEF_MAX,
  qualifierCandidat,
  rangGravite,
  SEUIL_ATTERRISSAGE_BRIEF_PCT,
  SEUIL_ATTERRISSAGE_ELEVE_BRIEF_PCT,
  SEUILS_ATTENTE_BRIEF,
  SEUILS_RETARD_BRIEF,
  SEUILS_RETARD_FACTURE_BRIEF,
} from "./qualification";
export {
  ErreurBrief,
  FAMILLE_DU_TYPE,
  FAMILLES_BRIEF,
  GRAVITES_BRIEF,
  TYPES_ELEMENT_BRIEF,
  TYPES_PAR_FAMILLE,
  type BriefCompose,
  type CandidatBrief,
  type CodeErreurBrief,
  type ElementBrief,
  type EntreeBrief,
  type FamilleBrief,
  type FamilleComposee,
  type FaitsBrief,
  type GraviteBrief,
  type SourceBrief,
  type StatutPeriodeBrief,
  type TypeElementBrief,
} from "./types";
