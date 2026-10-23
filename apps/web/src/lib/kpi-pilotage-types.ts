/**
 * Contrats des réponses de l'API du pilotage augmenté des KPI. Voir `kpi-pilotage.ts`, point
 * d'entrée du module.
 */
import type { StatutActionKpi, StatutDecisionKpi, StatutRevueKpi } from "@missionpilot/shared";

// --- Réponses de l'API ----------------------------------------------------------------------

export type RelationArbre = "somme" | "produit";
export type NiveauQualite = "bon" | "moyen" | "faible";
export type VerdictEfficacite = "efficace" | "inefficace" | "neutre" | "indeterminee";

export interface ArbreResume {
  id: string;
  mission_id: string;
  kpi_racine_id: string;
  libelle: string;
  description: string | null;
  actif: boolean;
  nombre_noeuds?: number;
}

export interface NoeudArbre {
  id: string;
  parent_id: string | null;
  kpi_id: string | null;
  kpi_libelle: string | null;
  kpi_unite: string | null;
  libelle: string;
  relation: RelationArbre;
  coefficient: number;
  rang: number;
  actif: boolean;
}

export interface DetailArbre extends ArbreResume {
  noeuds: NoeudArbre[];
}

export interface NoeudContribution extends NoeudArbre {
  profondeur: number;
  feuille: boolean;
  avant: number | null;
  apres: number | null;
  variation: number | null;
  residu_avant: number | null;
  residu_apres: number | null;
  contribution_parent: number | null;
  part_parent: number | null;
  contribution_racine: number | null;
  contribution_racine_exacte: string | null;
  part_racine: number | null;
  evaluable: boolean;
}

export interface LevierContribution {
  noeud_id: string;
  libelle: string;
  kpi_id: string | null;
  contribution_racine: number;
  part_racine: number | null;
  favorable: boolean | null;
  rang: number;
}

/** Une somme qui additionne des unités différentes (« 55 jours + 72 % »), signalée par l'API. */
export interface AvertissementUnite {
  parent_id: string;
  parent_libelle: string;
  noeud_id: string;
  noeud_libelle: string;
  unite_reference: string;
  unite: string;
  message: string;
}

export interface ContributionsArbre {
  arbre_id: string;
  kpi_racine_id: string;
  sens: "plus_haut_mieux" | "plus_bas_mieux";
  unite: string;
  avant: string;
  apres: string;
  evaluable: boolean;
  manquants: { noeud_id: string; libelle: string }[];
  variation_racine: number | null;
  avertissements_unites?: AvertissementUnite[];
  noeuds: NoeudContribution[];
  leviers: LevierContribution[];
}

export interface QualiteKpiVue {
  score: number | null;
  niveau: NiveauQualite | null;
  fraicheur: number | null;
  completude: number | null;
  coherence: number | null;
  motifs: string[];
  details: {
    periodes_exigibles: number;
    periodes_mesurees: number;
    periodes_fenetre: number;
    periodes_mesurees_fenetre: number;
    retard_periodes: number;
    nombre_corrections: number;
    nombre_lignes: number;
    valeurs_aberrantes: { date: string; valeur: number }[];
  };
}

export interface QualiteMission {
  mission_id: string;
  date_reference: string;
  repartition: { bon: number; moyen: number; faible: number; non_evaluable: number };
  kpis: {
    kpi_id: string;
    libelle: string;
    perspective: string | null;
    frequence: string;
    qualite: QualiteKpiVue;
  }[];
}

export interface EfficaciteVue {
  date_effet: string;
  verdict: VerdictEfficacite;
  periode_effet: string | null;
  moyenne_avant: number | null;
  moyenne_apres: number | null;
  variation: number | null;
  variation_relative: number | null;
  variation_orientee: number | null;
  nombre_avant: number;
  nombre_apres: number;
  manquant_avant: number;
  manquant_apres: number;
  periodes_avant: { periode: string; valeur: number | null }[];
  periodes_apres: { periode: string; valeur: number | null }[];
}

export interface EvenementAction {
  id: string;
  type: "creation" | "statut" | "modification" | "commentaire";
  statut_avant: string | null;
  statut_apres: string;
  commentaire: string | null;
  auteur_nom: string | null;
  cree_le: string;
}

export interface ActionKpi {
  id: string;
  mission_id: string;
  kpi_id: string;
  kpi_libelle: string;
  alerte_id: string | null;
  revue_id: string | null;
  decision_id: string | null;
  numero: number;
  titre: string;
  description: string | null;
  responsable_id: string;
  responsable_nom: string | null;
  echeance: string;
  statut: StatutActionKpi;
  date_effet: string | null;
  motif: string | null;
  efficacite: EfficaciteVue | null;
  evenements?: EvenementAction[];
}

export interface PageActions {
  elements: ActionKpi[];
  curseur_suivant: string | null;
}

export interface PointOrdreDuJour {
  rang: number;
  code: string;
  libelle: string;
  kpi_id: string | null;
  action_id: string | null;
  decision_id: string | null;
  priorite: number;
  duree_minutes: number;
  origine: "moteur" | "manuel";
}

export interface RevueKpi {
  id: string;
  mission_id: string;
  numero: number;
  titre: string;
  date_prevue: string;
  date_reference: string;
  statut: StatutRevueKpi;
  animateur_id: string | null;
  animateur_nom: string | null;
  ordre_du_jour: PointOrdreDuJour[];
  compte_rendu: string | null;
  dossier_fige: boolean;
}

export interface DecisionKpi {
  id: string;
  revue_id: string;
  numero: number;
  libelle: string;
  kpi_id: string | null;
  responsable_id: string | null;
  responsable_nom: string | null;
  echeance: string | null;
  statut: StatutDecisionKpi;
  motif: string | null;
}

/** Événement de l'historique d'une décision (ajout seul) : création, changement de statut. */
export interface EvenementDecision {
  id: string;
  decision_id: string;
  type: "creation" | "statut" | "modification";
  statut_avant: string | null;
  statut_apres: string;
  commentaire: string | null;
  auteur_nom: string | null;
  cree_le: string;
}

export interface DetailRevue extends RevueKpi {
  decisions: DecisionKpi[];
  evenements_decisions?: EvenementDecision[];
  actions: ActionKpi[];
  /** Listes plafonnées à 500 lignes par l'API : vrai si la liste servie est incomplète. */
  decisions_tronque?: boolean;
  actions_tronque?: boolean;
  evenements_decisions_tronque?: boolean;
}

/** Réponse de la liste des arbres d'une mission (`tronque` : plus de 500 arbres). */
export interface ListeArbres {
  elements: ArbreResume[];
  tronque?: boolean;
}

/** Mention d'une liste plafonnée par l'API, ou null si elle est complète. */
export function avertissementTronque(tronque: boolean | undefined, quoi: string): string | null {
  return tronque
    ? `La liste des ${quoi} est limitée aux 500 premières : les suivantes ne sont pas affichées.`
    : null;
}

export interface PageRevues {
  elements: RevueKpi[];
  curseur_suivant: string | null;
}
