import type { CleCompte } from "../cles.js";
import type { CleMissionCasting } from "./outils.js";

/* Types des données de la capitalisation du Tenant démo (retours, briques, compétences, efficacité). */

export interface SectionsRetour {
  contexte: string;
  methode: string;
  ecarts: string;
  lecons: string;
}

/** Rédaction d'un retour : v2 par le chef de mission, v3 (revue) par le directeur, validation par un associé. */
export interface RetourRedige {
  v2: SectionsRetour;
  v3: Partial<SectionsRetour>;
  auteurV2: CleCompte;
  auteurV3: CleCompte;
  valideur: CleCompte;
}

export type RetoursParMission = Partial<Record<CleMissionCasting, RetourRedige>>;

export interface TacheDemo {
  libelle: string;
  /** Code de la brique de la méthode de la mission à laquelle la tâche est rattachée. */
  brique: string;
  duree: number;
}

export interface PlanBriques {
  /** Code de la méthode du référentiel liée à la mission (sinon aucune brique n'est rattachée). */
  methode: string;
  phases: { libelle: string; taches: TacheDemo[] }[];
}
