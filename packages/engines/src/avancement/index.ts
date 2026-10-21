/**
 * Moteur du rapport d'avancement hebdomadaire au client (AUT-10, PRD complémentaire §8) : contenu
 * structuré tiré de faits déjà lus. Pur, sans entrée-sortie ; la date de référence est un paramètre.
 */
export { composerAvancementHebdo } from "./composition";
export {
  ErreurAvancement,
  PLAFOND_JALONS_PAR_LISTE,
  PLAFOND_KPI_RAPPORT,
  PLAFOND_LIBELLE_RAPPORT,
  PLAFOND_LIVRABLES_RAPPORT,
  VERSION_CONTENU_AVANCEMENT,
  type AvancementHebdo,
  type CodeErreurAvancement,
  type CodeFaitSaillant,
  type FaitSaillant,
  type FaitsAvancementHebdo,
  type JalonFait,
  type JalonRapport,
  type KpiFait,
  type KpiRapport,
  type LivrableFait,
  type LivrableRapport,
  type ListeJalonsRapport,
  type StatutKpiRapport,
} from "./types";
