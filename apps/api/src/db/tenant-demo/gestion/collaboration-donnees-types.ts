import type { CleMission } from "./casting.js";

/*
 * Types des données de la vie collaborative du Tenant démo (commentaires, tâches assignées).
 * Les personnes sont désignées par un RÔLE DANS LA MISSION (résolu à l'exécution depuis l'équipe
 * réelle de la mission, lot 2a), jamais par un identifiant : les textes citent les collègues par
 * le jeton `{@role}` (mention réelle, notifiée par la route).
 */

/** Rôle tenu dans la mission : directeur, chef, associé, consultants (par ordre alphabétique), expert, gestionnaire. */
export type RoleActeur = "dir" | "chef" | "assoc" | "c1" | "c2" | "c3" | "exp" | "gest" | "res";

/** Un message d'un fil de discussion. */
export interface Msg {
  de: RoleActeur;
  /** Texte brut ; `{@role}` = mention d'un collègue (avec notification). */
  t: string;
  /** Texte corrigé par l'auteur (modification dans le quart d'heure, historique conservé). */
  rev?: string;
  /** Suppression logique : par l'auteur ou par un associé (le fil garde une trace). */
  sup?: "auteur" | "associe";
}

/** Entité commentée : la mission, une de ses tâches (libellé contenant…), ou une pièce du pipeline. */
export type Cible =
  "mission" | { tache: string } | { opportunite: string } | { proposition: string };

export interface Fil {
  /** Mission du casting qui porte le fil (équipe, période). */
  m: CleMission;
  cible: Cible;
  /**
   * Mission/tâche : part (0 à 1) de la période de la mission écoulée à la date du premier message.
   * Opportunité/proposition : nombre de jours après sa création.
   */
  q: number;
  msgs: Msg[];
}

/** Tâche assignée (module « Mes tâches »). */
export interface TacheAssignee {
  m: CleMission | null;
  /** Libellé (contenu) d'une tâche de la mission à lier, sinon la mission elle-même. */
  tache?: string;
  /** Opportunité du pipeline à lier (intitulé exact), au lieu de la mission. */
  opportunite?: string;
  titre: string;
  description: string;
  de: RoleActeur;
  a: RoleActeur;
  /** Création : part de la période de la mission, ou nombre de jours avant aujourd'hui (`ilYa`). */
  q?: number;
  ilYa?: number;
  /** Échéance : jours après la création. */
  delai: number;
  statut: "a_faire" | "en_cours" | "fait";
  /** Pour une tâche faite : jours après la création (en plus de l'échéance si négatif ou nul). */
  faiteApres?: number;
}
