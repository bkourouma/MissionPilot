import type { TypeElementPlan } from "@missionpilot/shared";
import type { CleCompte } from "../cles.js";
import type { MissionCasting } from "./casting.js";

/*
 * Types des spécifications de plans (étape « plans-coeur »). Une spécification décrit un plan de
 * bout en bout ; le moteur (plans-coeur-moteur.ts) la rejoue par les routes de l'API, sans
 * doublon : chaque objet se retrouve par sa clé naturelle (titre, type, numéro de version).
 */

export type Donnees = Record<string, unknown>;
/** Identifiants des éléments déjà créés, par clé de spécification. */
export type Ids = ReadonlyMap<string, string>;
export type Valeur<T> = T | ((ids: Ids) => T);

/** Qui valide : le directeur de la mission, ou un associé (dispensés de la séparation des tâches). */
export type Valideur = "directeur" | "associe";
/** Qui rédige : le chef de mission ou un consultant de l'équipe. */
export type Auteur = "chef" | "consultant";

/** Une étape après la création : nouvelle version (fusion sur la version courante) ou validation. */
export type Etape = { maj: Valeur<Donnees>; auteur?: Auteur } | { valider: Valideur };

export interface SpecElement {
  /** Clé interne (parents, dépendances, KPI) ; n'est pas stockée. */
  cle: string;
  type: TypeElementPlan;
  /** Titre de l'élément (axe, objectif, initiative) : clé naturelle, inchangé par les étapes. */
  titre?: string;
  /** Clé du parent (objectif sous un axe ; initiative sous un axe ou un objectif). */
  parent?: string;
  /** Contenu complet de la version 1. */
  creation: Valeur<Donnees>;
  /** Création par la bibliothèque d'initiatives types (le contenu vient du modèle, `creation` est ignorée). */
  bibliotheque?: { code: string; debut: string; echeance?: string; budget?: number };
  etapes?: readonly Etape[];
  auteur?: Auteur;
  /** Porteur de la vision, d'un axe ou d'un objectif. */
  porteur?: CleCompte;
  /** Libellés EXACTS de KPI existants de la mission liés à l'objectif (SQL : la route en crée un neuf). */
  kpiExistants?: readonly string[];
}

export interface SpecKpiNouveau {
  /** Clé de l'objectif. */
  objectif: string;
  /** Corps de POST /plans/:id/objectifs/:elementId/kpi. */
  corps: Donnees;
}

export interface SpecNoeud {
  titre: string;
  description?: string;
  porteur?: CleCompte;
  debut?: string;
  echeance: string;
  /** Statuts successifs (une version par statut). */
  parcours: readonly string[];
}

export interface SpecProjet extends SpecNoeud {
  /** Clé de l'initiative parente. */
  initiative: string;
  jalons: readonly SpecNoeud[];
}

export interface Evaluation {
  valeur: number;
  effort: number;
  risque: number;
  charge_jours: number;
  commentaire?: string;
}

export interface SpecEvaluation {
  /** Clé de l'initiative. */
  initiative: string;
  /** Versions successives de l'évaluation. */
  versions: readonly Evaluation[];
}

export interface SpecArbitrage {
  budget_max: number | null;
  capacite_max: number | null;
  /** Clés d'initiatives à imposer ou à exclure. */
  obligatoires?: readonly string[];
  exclues?: readonly string[];
  /** Écart volontaire à la proposition du moteur (motif exigé par la route). */
  ajouter?: { initiative: string; motif: string };
  retirer?: { initiative: string; motif: string };
  commentaire: string;
}

export interface SpecModele {
  hypotheses: Donnees;
  commentaire: string;
  valider?: Valideur;
}

export interface SpecPlan {
  mission: MissionCasting;
  titre: string;
  horizon: number;
  elements: readonly SpecElement[];
  kpiNouveaux?: readonly SpecKpiNouveau[];
  projets?: readonly SpecProjet[];
  modeles?: readonly SpecModele[];
  evaluations?: readonly SpecEvaluation[];
  arbitrages?: readonly SpecArbitrage[];
  /** Partage au portail client en fin de parcours (contenu entièrement validé exigé). */
  partager?: boolean;
  /** Propose le portefeuille au moteur sans l'arbitrer (lecture, trace de journal). */
  proposerSeulement?: { budget_max: number | null; capacite_max: number | null };
  /** Lit la bancabilité (ratios et plan de financement du moteur) : exige un modèle validé. */
  verifierBancabilite?: boolean;
  /** Observations d'efficacité tirées d'initiatives du plan (clé d'initiative → observation). */
  observations?: readonly { initiative: string; efficacite: number; commentaire: string }[];
}

export interface ResumePlan {
  planId: string;
  missionId: string;
  titre: string;
  ids: Ids;
}
