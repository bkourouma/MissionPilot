import type { PerspectiveKpi, SensLectureKpiApi } from "@missionpilot/shared";
import type { MissionCasting } from "./casting.js";

/*
 * Types des données de l'étape « kpi » (catalogue des KPI par mission, revues et actions).
 * Les clés (`cle`) sont internes au seed : la clé naturelle en base est le libellé du KPI
 * (unique par mission), qui sert à retrouver un KPI déjà semé.
 */

/** Paramètres d'une série mensuelle pseudo-aléatoire (graine fixe) : base + tendance + saison + bruit. */
export interface ParamSerie {
  base: number;
  /** Variation par mois. */
  pente: number;
  /** Amplitude de la saisonnalité annuelle. */
  saison?: number;
  bruit: number;
  decimales: number;
  /** Valeurs imposées à certains mois (incidents qui déclenchent des alertes). */
  incidents?: Record<string, number>;
}

/** Série calculée à partir d'autres KPI de la mission (jamais saisie « à la main »). */
export type DeriveSerie =
  | { type: "somme"; termes: { cle: string; coef: number }[]; decimales: number }
  | { type: "produit"; facteurs: string[]; decimales: number }
  | { type: "ratio"; numerateur: string; denominateur: string; facteur: number; decimales: number };

/** Erreur de saisie planifiée : valeur fausse (finale × facteur), puis correction ou annulation. */
export interface ErreurSaisie {
  mois: string;
  facteur: number;
  motif: string;
}

export interface SpecKpi {
  cle: string;
  libelle: string;
  description: string;
  unite: string;
  perspective: PerspectiveKpi;
  sens: SensLectureKpiApi;
  nature: "flux" | "stock";
  ponderation?: number;
  seuilVert?: number;
  seuilOrange?: number;
  alerteHaut?: number;
  alerteBas?: number;
  alerteVariation?: number;
  /** Cible initiale ; `revision` : nouvelle version de cible à partir d'un mois. */
  cible: number;
  revision?: { mois: string; valeur: number; motif: string };
  serie: ParamSerie | DeriveSerie;
  proprio: "chef" | "directeur";
  /** Mois sans mesure (retard de saisie, trou de données). */
  manque?: string[];
  correction?: ErreurSaisie;
  annulation?: ErreurSaisie;
  /** Saisies faites par le client depuis le portail à partir d'un mois. */
  portail?: {
    comptes: ("dirigeant" | "contributeur")[];
    depuis: string;
    correction?: ErreurSaisie;
  };
}

export interface SpecArbre {
  racine: string;
  libelle: string;
  description: string;
  relation: "somme" | "produit";
  leviers: { cle: string; coefficient: number }[];
}

export type Responsable = "chef" | "directeur" | "membre";

export interface SpecAction {
  titre: string;
  description: string;
  kpi: string;
  responsable: Responsable;
  echeance: string;
  fin: "a_faire" | "en_cours" | "terminee" | "abandonnee";
  dateEffet?: string;
  commentaire?: string;
  motif?: string;
  /** Rattachée à l'alerte de ce code (la plus récente du KPI), si elle existe. */
  alerte?: "SEUIL_HAUT" | "SEUIL_BAS" | "VARIATION" | "DEGRADATION_CONSECUTIVE";
  commentaires?: string[];
}

export interface SpecDecision {
  libelle: string;
  kpi: string;
  responsable: Responsable;
  echeance: string;
  fin: "ouverte" | "en_cours" | "executee" | "abandonnee";
  commentaire?: string;
  motif?: string;
  actions: SpecAction[];
}

export interface SpecRevue {
  titre: string;
  date: string;
  etat: "planifiee" | "tenue" | "cloturee" | "annulee";
  compteRendu?: string;
  decisions: SpecDecision[];
}

export interface SpecMissionKpi {
  mission: MissionCasting;
  kpis: SpecKpi[];
  arbre?: SpecArbre;
  revues: SpecRevue[];
  /** Actions correctives non rattachées à une décision de revue. */
  actions: SpecAction[];
}
