import type { Decoupage, Deplacement } from "../../../../../lib/decoupage";
import type { GradeDecoupage } from "./FormulairesDecoupage";

export interface DroitsDecoupage {
  planifier: boolean;
  budgeter: boolean;
  lireBudget: boolean;
}

export interface Contexte {
  missionId: string;
  decoupage: Pick<Decoupage, "phases">;
  grades: GradeDecoupage[];
  droits: DroitsDecoupage;
  /** Jours budgétés agrégés par le moteur (identifiant d'élément → jours). */
  budgets: Record<string, number>;
  collaboration: CollaborationDecoupage;
  annoncer: (message: string) => void;
  reorganiser: (deplacements: Deplacement[], message: string) => Promise<boolean>;
}

/** Utilisateur courant, pour les commentaires des tâches (SOC-08). */
export interface CollaborationDecoupage {
  utilisateurId: string;
  associe: boolean;
}

export type Mode = "lecture" | "edition" | "ajout-lot" | "ajout-tache" | "parent" | "budget";
