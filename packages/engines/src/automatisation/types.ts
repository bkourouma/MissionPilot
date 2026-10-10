import type { NiveauAutonomie } from "../autonomie/niveaux";
import type { ClasseRisque } from "../qualite/classes";

/*
 * Types du moteur d'automatisation (AUT-01 à AUT-06, PRD complémentaire §8, ADR-006).
 *
 * Forme JSON UNIQUE : une condition se stocke telle quelle (jsonb) et le schéma partagé
 * (`packages/shared/src/schemas/automatisation.ts`) en décrit exactement la même forme ;
 * aucune conversion entre la base, l'API et le moteur.
 */

/** Type d'un champ du contenu (payload) d'un événement métier. */
export const TYPES_CHAMP_EVENEMENT = ["texte", "nombre", "booleen", "date", "identifiant"] as const;
export type TypeChampEvenement = (typeof TYPES_CHAMP_EVENEMENT)[number];

export interface ChampEvenement {
  readonly type: TypeChampEvenement;
  /** Champ obligatoire du contenu publié (sinon facultatif, `null` admis). */
  readonly requis: boolean;
}

/** Champs typés d'un événement, par nom. */
export type ChampsEvenement = Readonly<Record<string, ChampEvenement>>;

export type ValeurPayload = string | number | boolean | null;
/** Contenu d'un événement : valeurs scalaires seulement (aucun objet imbriqué). */
export type PayloadEvenement = Readonly<Record<string, ValeurPayload>>;

export const OPERATEURS_AUTOMATISATION = [
  "egal",
  "different",
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
  "dans",
  "contient",
] as const;
export type OperateurAutomatisation = (typeof OPERATEURS_AUTOMATISATION)[number];

export type ValeurCompareeAutomatisation =
  string | number | boolean | readonly string[] | readonly number[];

/** Condition (récursive) sur le contenu d'un événement. */
export type ConditionAutomatisation =
  | { readonly type: "tous"; readonly conditions: readonly ConditionAutomatisation[] }
  | { readonly type: "au_moins_un"; readonly conditions: readonly ConditionAutomatisation[] }
  | { readonly type: "non"; readonly condition: ConditionAutomatisation }
  | {
      readonly type: "comparaison";
      readonly champ: string;
      readonly operateur: OperateurAutomatisation;
      readonly valeur: ValeurCompareeAutomatisation;
    }
  | { readonly type: "renseigne"; readonly champ: string };

/** Bornes d'une condition : profondeur et nombre de nœuds. */
export const PROFONDEUR_CONDITION_AUTOMATISATION_MAX = 4;
export const NOEUDS_CONDITION_AUTOMATISATION_MAX = 30;
/** Éléments d'une liste comparée (« dans »). */
export const VALEURS_LISTE_AUTOMATISATION_MAX = 50;
/** Actions d'une automatisation. */
export const ACTIONS_PAR_AUTOMATISATION_MAX = 10;

export interface DefinitionPlanifiable<A> {
  /** `null` : l'automatisation se déclenche sur tout événement de son type. */
  readonly condition: ConditionAutomatisation | null;
  readonly actions: readonly A[];
}

/** Ce que le moteur sait d'une action pour la garder (AUT-05). */
export interface MetaAction {
  readonly classeRisque: ClasseRisque;
  /** L'action atteint le client (exécution N4). */
  readonly versClient: boolean;
  /** Niveau effectif minimal de la brique d'agent appelée (action « appeler un agent »). */
  readonly niveauAgentRequis?: NiveauAutonomie | null;
}

/** État dans lequel l'action serait exécutée. */
export interface ContexteGarde {
  readonly coupeCircuitCabinet: boolean;
  readonly coupeCircuitAutomatisation: boolean;
  /** Coupe-circuit N4 du cabinet (agents IA) : aucune exécution automatique vers le client. */
  readonly coupeCircuitN4: boolean;
  /** L'exécutant (compte d'automatisation ou déclencheur) détient la permission de l'action. */
  readonly droitsSuffisants: boolean;
  /** L'exécutant voit la mission de l'événement (vrai sans mission). */
  readonly missionVisible: boolean;
  /** Niveau effectif de la brique de l'agent appelé ; `null` si inconnu. */
  readonly niveauAgentEffectif?: NiveauAutonomie | null;
}

export const REFUS_GARDE_AUTOMATISATION = [
  "COUPE_CIRCUIT_CABINET",
  "COUPE_CIRCUIT_AUTOMATISATION",
  "COUPE_CIRCUIT_N4",
  "CONTENU_R2_R3_VERS_CLIENT",
  "N4_RESERVE_R0",
  "NIVEAU_AGENT_INSUFFISANT",
  "DROITS_INSUFFISANTS",
  "MISSION_INVISIBLE",
] as const;
export type RefusGardeAutomatisation = (typeof REFUS_GARDE_AUTOMATISATION)[number];

export interface DecisionGarde {
  readonly autorisee: boolean;
  /** Raisons du refus, dans l'ordre de `REFUS_GARDE_AUTOMATISATION` ; vide si autorisée. */
  readonly refus: readonly RefusGardeAutomatisation[];
}
