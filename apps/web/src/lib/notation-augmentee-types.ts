/** Notation augmentée : types des réponses de l'API (voir `notation-augmentee.ts`). */
import type { GenerationIa } from "./ia-contenu";
import { type Classe } from "./notation";

export type NiveauConfiance = "elevee" | "suffisante" | "insuffisante";

export interface ConfianceNotation {
  numero: number;
  statut: string;
  indice: number;
  seuil: number;
  publiable: boolean;
  niveau: NiveauConfiance;
  couverture: { valeur: number; poids: number };
  repondants: { valeur: number; poids: number; nombre: number; cible: number };
  preuves: {
    valeur: number;
    poids: number;
    dimensions_etayees: number;
    dimensions: number;
    assertions: number;
  };
}

export interface ConstatPerception {
  question: string;
  libelle: string;
  type: "entre_populations" | "interne";
  gravite: "majeur" | "notable";
  ecart: number;
  niveau_bas: number;
  niveau_haut: number;
  populations_basses: string[];
  populations_hautes: string[];
  nombre_repondants: number;
  enonce: string;
}

export interface ConstatsNotation {
  numero: number;
  statut: string;
  constats: ConstatPerception[];
}

export interface ContributionPratique {
  indicateur: string;
  question: string;
  statut: "repondu" | "manquant" | "sans_objet";
  points: number | null;
  poids: number;
  contribution: number;
}

export interface ContributionDimension {
  dimension: string;
  libelle: string;
  notable: boolean;
  poids: number;
  score: number | null;
  contribution: number;
  ajustement: number;
  ecart_arrondi: number;
  pratiques: ContributionPratique[];
}

export interface EtapeSimulation {
  dimension: string;
  libelle: string;
  indicateur: string;
  question: string;
  points_avant: number;
  points_apres: number;
  paliers: number;
  gain: number;
}

export interface SimulationPassage {
  classe_actuelle: Classe;
  score_actuel: number;
  cible: Classe;
  seuil: number;
  deja_atteinte: boolean;
  atteignable: boolean;
  gain_necessaire: number;
  score_projete: number;
  classe_projetee: Classe;
  /** Vrai si le plafond de pas a interrompu la simulation avant la cible. */
  tronquee?: boolean;
  etapes: EtapeSimulation[];
}

/** Pratique répondue qu'une combinaison peut relever, avec ses paliers (points croissants). */
export interface LevierCombinaison {
  dimension: string;
  libelle: string;
  indicateur: string;
  question: string;
  points_actuels: number;
  paliers: number[];
}

export interface EtapeCombinaison {
  dimension: string;
  libelle: string;
  indicateur: string;
  question: string;
  points_avant: number;
  points_apres: number;
  /** Nombre de crans franchis. */
  paliers: number;
  gain: number;
}

export interface CombinaisonAmelioration {
  etapes: EtapeCombinaison[];
  score_projete: number;
  classe_projetee: Classe;
  nombre_paliers: number;
}

/**
 * Combinaisons MINIMALES d'améliorations vers la classe visée (moteur, NOT-12). `tronquee` : une
 * borne a interrompu la recherche ; l'impossibilité n'est alors pas établie.
 */
export interface CombinaisonsNotation {
  classe_actuelle: Classe;
  score_actuel: number;
  cible: Classe;
  seuil: number;
  deja_atteinte: boolean;
  atteignable: boolean;
  gain_necessaire: number;
  nombre_minimal_pratiques: number | null;
  exhaustive: boolean;
  tronquee: boolean;
  combinaisons: CombinaisonAmelioration[];
  leviers: LevierCombinaison[];
}

export interface ExplicationNotation {
  numero: number;
  statut: string;
  score: number;
  classe: Classe;
  strategie: "ignorer" | "penaliser";
  somme_contributions: number;
  dimensions: ContributionDimension[];
  simulation: SimulationPassage | null;
  /** Absent d'une API plus ancienne ; null quand la classe A est déjà atteinte. */
  combinaisons?: CombinaisonsNotation | null;
}

/**
 * GET et POST /api/notations/:id/explication/commentaire : le dernier commentaire IA (brouillon à
 * valider) de la version, sous la forme d'une génération (`/api/ia/generations/:id`), ou null.
 */
export interface CommentaireExplication {
  numero: number;
  statut_contenu: GenerationIa["statut_contenu"];
  commentaire: GenerationIa | null;
}

export type SourceImpact = "contexte_semblable" | "secteur" | "taille" | "general" | "aucun";

export interface InitiativePriorisee {
  code: string;
  titre: string;
  rang: number;
  priorite: number;
  besoin: number;
  impact: number;
  source_impact: SourceImpact;
  observations: number;
  effort: number;
  duree_mois: number;
  dimensions: string[];
  retenue: boolean;
  motif: string;
}

export interface PlanActionPropose {
  version_id: string;
  numero: number;
  contexte: { secteur: string | null; taille: string | null };
  capacite: number;
  capacite_utilisee: number;
  initiatives: InitiativePriorisee[];
}

export interface ElementBanque {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  intitule: string | null;
  version_validee: number | null;
  modifie_le: string;
}

export interface ElementCalibration {
  id: string;
  titre: string;
  nombre_cas: number;
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_le: string;
  cloturee_le: string | null;
  close: boolean;
  evaluateurs: number;
}

export interface Page<T> {
  elements: T[];
  curseur_suivant: string | null;
}
