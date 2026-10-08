/**
 * Vocabulaire du moteur de modulation (STD-04, STD-05, PRD complémentaire
 * §4.3 et §4.4) : facteurs de contexte typés, conditions combinables, effets
 * typés, règles priorisées.
 *
 * La forme JSON d'une règle est IDENTIQUE à celle du schéma partagé
 * (`packages/shared`, `regleModulationSchema`) : une règle se stocke en base
 * (jsonb) et s'évalue telle quelle, sans conversion. Les clés sont donc des
 * mots simples en minuscules.
 */
import type { ClasseRisque } from "../qualite/classes";

// ---------------------------------------------------------------------------
// Bornes (doublées par le schéma partagé)
// ---------------------------------------------------------------------------

export const REGLES_MODULATION_MAX = 500;
export const EFFETS_PAR_REGLE_MAX = 50;
/** Profondeur maximale d'une condition (la racine compte pour 1). */
export const PROFONDEUR_CONDITION_MAX = 8;
/** Nœuds au plus dans la condition d'une règle. */
export const NOEUDS_CONDITION_MAX = 100;
export const PRIORITE_MODULATION_MAX = 1_000;
/** Valeurs au plus dans une liste (énumération, facteur liste, comparaison « dans »). */
export const VALEURS_LISTE_MAX = 200;
/** Longueur maximale d'un code (règle, facteur, brique, item, cible, choix). */
export const LONGUEUR_CODE_MAX = 120;

// ---------------------------------------------------------------------------
// Facteurs de contexte
// ---------------------------------------------------------------------------

export const TYPES_FACTEUR_CONTEXTE = ["booleen", "nombre", "enumeration", "liste"] as const;
export type TypeFacteurContexte = (typeof TYPES_FACTEUR_CONTEXTE)[number];

export interface DefinitionFacteurContexte {
  readonly code: string;
  readonly type: TypeFacteurContexte;
  /** Valeurs permises : obligatoires pour une énumération ou une liste. */
  readonly valeurs?: readonly string[];
  /** Bornes incluses d'un nombre. */
  readonly min?: number;
  readonly max?: number;
}

export type ValeurFacteurContexte = boolean | number | string | readonly string[];

/** Contexte d'une mission : valeur par code de facteur ; `null` ou absent = non renseigné. */
export type ContexteModulation = Readonly<Record<string, ValeurFacteurContexte | null | undefined>>;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const COMPARATEURS_MODULATION = [
  "egal",
  "different",
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
  "dans",
  "contient",
] as const;
export type ComparateurModulation = (typeof COMPARATEURS_MODULATION)[number];

export type ValeurComparee = boolean | number | string | readonly string[] | readonly number[];

export const TYPES_CONDITION_MODULATION = [
  "tous",
  "au_moins_un",
  "non",
  "comparaison",
  "brique_active",
] as const;
export type TypeConditionModulation = (typeof TYPES_CONDITION_MODULATION)[number];

export type ConditionModulation =
  | { readonly type: "tous"; readonly conditions: readonly ConditionModulation[] }
  | { readonly type: "au_moins_un"; readonly conditions: readonly ConditionModulation[] }
  | { readonly type: "non"; readonly condition: ConditionModulation }
  | {
      readonly type: "comparaison";
      readonly facteur: string;
      readonly comparateur: ComparateurModulation;
      readonly valeur: ValeurComparee;
    }
  /** Vraie si la brique est active après les règles qui la modifient (dépendance entre règles). */
  | { readonly type: "brique_active"; readonly brique: string };

// ---------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------

export const TYPES_EFFET_MODULATION = [
  "activer_brique",
  "retirer_brique",
  "activer_item",
  "retirer_item",
  "ponderation",
  "seuil",
  "benchmark",
  "gabarit",
  "formulation",
  "recommandation_candidate",
  "relever_classe_risque",
] as const;
export type TypeEffetModulation = (typeof TYPES_EFFET_MODULATION)[number];

export type EffetModulation =
  | { readonly type: "activer_brique"; readonly brique: string }
  | { readonly type: "retirer_brique"; readonly brique: string }
  | { readonly type: "activer_item"; readonly item: string }
  | { readonly type: "retirer_item"; readonly item: string }
  /** Pondération (≥ 0) d'une dimension, d'un item ou d'un KPI. */
  | { readonly type: "ponderation"; readonly cible: string; readonly valeur: number }
  | { readonly type: "seuil"; readonly cible: string; readonly valeur: number }
  | { readonly type: "benchmark"; readonly cible: string; readonly choix: string }
  | { readonly type: "gabarit"; readonly cible: string; readonly choix: string }
  | { readonly type: "formulation"; readonly cible: string; readonly choix: string }
  | { readonly type: "recommandation_candidate"; readonly recommandation: string }
  /** Relève (jamais n'abaisse) la classe de risque d'un livrable ou d'une brique. */
  | {
      readonly type: "relever_classe_risque";
      readonly cible: string;
      readonly classe: ClasseRisque;
    };

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

export interface RegleModulation {
  /** Identifiant stable et unique dans le jeu de règles. */
  readonly code: string;
  readonly libelle?: string;
  /** Entier de 0 à 1 000 : la plus haute l'emporte en cas de conflit. */
  readonly priorite: number;
  readonly condition: ConditionModulation;
  readonly effets: readonly EffetModulation[];
  /** Règle désactivée : journalisée, jamais évaluée (défaut : active). */
  readonly active?: boolean;
}

/** Référentiel des codes connus, pour la validation d'un jeu de règles. */
export interface ReferentielModulation {
  readonly facteurs: readonly DefinitionFacteurContexte[];
  /** Ensembles de codes ; un ensemble absent n'est pas contrôlé. */
  readonly briques?: readonly string[];
  readonly items?: readonly string[];
  /** Cibles des pondérations, seuils, benchmarks, gabarits, formulations et classes de risque. */
  readonly cibles?: readonly string[];
  /** Codes des benchmarks, gabarits et formulations. */
  readonly choix?: readonly string[];
  readonly recommandations?: readonly string[];
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export type CodeAnomalieModulation =
  | "REGLES_TROP_NOMBREUSES"
  | "REGLE_INVALIDE"
  | "CODE_INVALIDE"
  | "CODE_EN_DOUBLE"
  | "PRIORITE_INVALIDE"
  | "CONDITION_INVALIDE"
  | "CONDITION_TROP_COMPLEXE"
  | "EFFET_INVALIDE"
  | "FACTEUR_DEFINITION_INVALIDE"
  | "FACTEUR_INCONNU"
  | "COMPARATEUR_INCOMPATIBLE"
  | "VALEUR_INVALIDE"
  | "REFERENCE_INCONNUE"
  | "CONFLIT_INTERNE"
  | "CYCLE"
  | "CONFLIT_MEME_PRIORITE"
  | "REGLE_SANS_EFFET";

export type GraviteAnomalieModulation = "erreur" | "avertissement";

export interface AnomalieModulation {
  readonly code: CodeAnomalieModulation;
  readonly gravite: GraviteAnomalieModulation;
  /** Code de la règle en cause ; null pour une anomalie d'ensemble ou de définition. */
  readonly regle: string | null;
  /** Chemin de l'élément fautif (`regles[2].condition.conditions[0]`). */
  readonly chemin: string;
  readonly message: string;
}
