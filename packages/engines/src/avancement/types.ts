import type { DateISO } from "../commun/dates";

/*
 * Rapport d'avancement hebdomadaire au client (AUT-10, PRD complémentaire §8) : types du moteur.
 *
 * Le moteur est PUR : il reçoit des FAITS déjà lus (avancement physique, jalons, KPI, livrables d'une
 * mission) et en tire le contenu structuré du rapport. Tous les chiffres du rapport sortent d'ici ;
 * aucun modèle de langage n'en produit. Les faits ne portent AUCUNE donnée financière interne
 * (coût, taux, marge, budget en jours, grade, temps par personne) : le contenu est destiné au client
 * (FIN-02) et le moteur n'a de toute façon pas où les mettre.
 */

export const VERSION_CONTENU_AVANCEMENT = 1;

/** Plafonds d'éléments détaillés par liste (les comptes restent exacts). */
export const PLAFOND_JALONS_PAR_LISTE = 20;
export const PLAFOND_KPI_RAPPORT = 30;
export const PLAFOND_LIVRABLES_RAPPORT = 30;
/** Plafond de longueur d'un libellé repris dans le rapport. */
export const PLAFOND_LIBELLE_RAPPORT = 200;

export type StatutKpiRapport = "vert" | "orange" | "rouge" | "non_evalue";

export interface JalonFait {
  readonly libelle: string;
  /** Date prévue (AAAA-MM-JJ), ou null. */
  readonly datePrevue: DateISO | null;
  readonly atteint: boolean;
}

export interface KpiFait {
  readonly libelle: string;
  readonly unite: string;
  /** Valeur de la dernière période close mesurée, ou null. */
  readonly valeur: number | null;
  readonly cible: number | null;
  /** Statut du moteur KPI (vert, orange, rouge, non mesuré, sans cible). */
  readonly statut: "vert" | "orange" | "rouge" | "non_mesure" | "sans_cible";
  /** Clé de la période de la valeur (ex. « 2026-09 »), ou null. */
  readonly periode: string | null;
}

export interface LivrableFait {
  readonly nom: string;
  readonly type: string;
  readonly version: number;
  /** Partagé avec le client sur le portail. */
  readonly partage: boolean;
}

export interface FaitsAvancementHebdo {
  /** Lundi de la semaine couverte. */
  readonly semaine: DateISO;
  /** Jour du calcul (sert à dire ce qui est en retard ou à venir). */
  readonly dateReference: DateISO;
  readonly mission: { readonly intitule: string; readonly statut: string };
  /** Avancement physique dans [0 ; 1] (moteur de suivi), ou null s'il n'est pas mesurable. */
  readonly avancement: number | null;
  /** Nombre d'éléments (jalons et livrables) qui fondent l'avancement. */
  readonly elementsAvancement: number;
  readonly jalons: readonly JalonFait[];
  readonly kpis: readonly KpiFait[];
  readonly livrables: readonly LivrableFait[];
}

export interface JalonRapport {
  readonly libelle: string;
  readonly date_prevue: DateISO | null;
}

export interface ListeJalonsRapport {
  /** Nombre exact (la liste peut être plafonnée). */
  readonly nombre: number;
  readonly elements: readonly JalonRapport[];
}

export interface KpiRapport {
  readonly libelle: string;
  readonly unite: string;
  readonly valeur: number | null;
  readonly cible: number | null;
  readonly statut: StatutKpiRapport;
  readonly periode: string | null;
}

export interface LivrableRapport {
  readonly nom: string;
  readonly type: string;
  readonly version: number;
}

export type CodeFaitSaillant =
  "avancement" | "jalons_atteints" | "jalons_en_retard" | "jalons_a_venir" | "kpis" | "livrables";

export interface FaitSaillant {
  readonly code: CodeFaitSaillant;
  readonly texte: string;
}

export interface AvancementHebdo {
  readonly version: typeof VERSION_CONTENU_AVANCEMENT;
  readonly semaine: DateISO;
  /** Dimanche de la semaine. */
  readonly semaine_fin: DateISO;
  readonly date_reference: DateISO;
  readonly mission: { readonly intitule: string; readonly statut: string };
  readonly avancement: {
    /** Pourcentage entier 0 à 100, ou null s'il n'est pas mesurable. */
    readonly pourcentage: number | null;
    readonly elements: number;
  };
  readonly jalons: {
    readonly total: number;
    readonly atteints: ListeJalonsRapport;
    readonly en_retard: ListeJalonsRapport;
    readonly a_venir: ListeJalonsRapport;
    /** Jalons non atteints sans date prévue. */
    readonly sans_date: number;
  };
  readonly kpis: {
    readonly total: number;
    readonly vert: number;
    readonly orange: number;
    readonly rouge: number;
    readonly non_evalue: number;
    readonly elements: readonly KpiRapport[];
  };
  readonly livrables: {
    readonly total: number;
    /** Livrables partagés avec le client (seuls ceux-ci sont détaillés). */
    readonly partages: number;
    /** Livrables non partagés : un nombre, jamais leur nom. */
    readonly non_partages: number;
    readonly elements: readonly LivrableRapport[];
  };
  /** Phrases déterministes du résumé (aucun texte libre d'un modèle), chacune avec son code de section. */
  readonly faits_saillants: readonly FaitSaillant[];
}

export type CodeErreurAvancement =
  "SEMAINE_INVALIDE" | "DATE_INVALIDE" | "AVANCEMENT_INVALIDE" | "FAIT_INVALIDE";

export class ErreurAvancement extends Error {
  readonly code: CodeErreurAvancement;

  constructor(code: CodeErreurAvancement, message: string) {
    super(message);
    this.name = "ErreurAvancement";
    this.code = code;
  }
}
