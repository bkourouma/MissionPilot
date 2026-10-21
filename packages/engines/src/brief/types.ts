import type { DateISO } from "../commun/dates";

/*
 * Brief quotidien par rôle (AUT-07, PRD complémentaire §8.3) : types du moteur.
 *
 * Le brief est un calcul DÉTERMINISTE : aucune valeur ne vient d'un modèle de langage. Le moteur
 * reçoit des FAITS déjà extraits par l'API, dans les droits de l'utilisateur (permissions et
 * visibilité des missions), et en tire la gravité, l'ordre, le bornage et le libellé. Aucune
 * entrée-sortie, aucune horloge : la date de référence est un paramètre.
 */

/** Trois familles du brief : ce qui attend une décision, ce qui dérive, ce qui est prêt à partir. */
export const FAMILLES_BRIEF = ["decider", "deriver", "envoyer"] as const;
export type FamilleBrief = (typeof FAMILLES_BRIEF)[number];

/** Gravité calculée par le moteur (jamais fournie par l'appelant). */
export const GRAVITES_BRIEF = ["haute", "moyenne", "basse"] as const;
export type GraviteBrief = (typeof GRAVITES_BRIEF)[number];

/** Types d'éléments du brief, regroupés par famille (l'ordre sert de dernier critère de tri). */
export const TYPES_PAR_FAMILLE = {
  decider: [
    "facture_a_approuver",
    "debours_a_valider",
    "feuille_a_valider",
    "conge_a_valider",
    "proposition_a_valider",
    "notation_a_publier",
    "livrable_a_relire",
    "livrable_a_signer",
    "derogation_a_accorder",
    "piece_a_examiner",
    "brouillon_automatisation",
    "retour_a_valider",
    "cloture_en_attente",
    "offre_technique_a_valider",
    "plan_a_valider",
    "revision_budget_a_valider",
  ],
  deriver: [
    "kpi_rouge",
    "kpi_orange_consecutif",
    "atterrissage_depasse",
    "facture_echue",
    "jalon_en_retard",
    "tache_en_retard",
    "feuille_non_soumise",
    "questionnaire_sans_reponse",
    "voyant_rouge",
  ],
  envoyer: [
    "proposition_a_envoyer",
    "facture_a_emettre",
    "facture_a_envoyer",
    "relance_prete",
    "demande_salle_a_envoyer",
    "livrable_signe",
  ],
} as const;

export type TypeElementBrief =
  | (typeof TYPES_PAR_FAMILLE.decider)[number]
  | (typeof TYPES_PAR_FAMILLE.deriver)[number]
  | (typeof TYPES_PAR_FAMILLE.envoyer)[number];

/** Tous les types, dans l'ordre de tri (famille puis ordre de déclaration). */
export const TYPES_ELEMENT_BRIEF: readonly TypeElementBrief[] = FAMILLES_BRIEF.flatMap(
  (f) => TYPES_PAR_FAMILLE[f],
);

/** Famille d'un type d'élément. */
export const FAMILLE_DU_TYPE: Readonly<Record<TypeElementBrief, FamilleBrief>> = Object.fromEntries(
  FAMILLES_BRIEF.flatMap((f) => TYPES_PAR_FAMILLE[f].map((t) => [t, f] as const)),
) as Record<TypeElementBrief, FamilleBrief>;

/** Statut d'une période de KPI close et mesurée (la sélection est faite par l'API). */
export type StatutPeriodeBrief = "vert" | "orange" | "rouge";

/**
 * Faits propres à la nature de l'élément :
 * - `attente` : ce qui attend depuis une date (décision, envoi) ; l'ancienneté en part ;
 * - `retard` : une échéance qui peut être dépassée ; sans retard, pas d'élément ;
 * - `kpi` : statuts des dernières périodes closes mesurées, de la plus récente à la plus ancienne ;
 * - `atterrissage` : jours du budget et jours d'atterrissage (suivi en jours, jamais en montant) ;
 * - `voyant` : voyant de pilotage d'un dossier de redressement (calculé par le moteur du
 *   redressement) et libellés de ses motifs critiques, en texte, sans aucun montant.
 */
export type FaitsBrief =
  | { readonly nature: "attente"; readonly depuis: DateISO | null }
  | { readonly nature: "retard"; readonly echeance: DateISO }
  | {
      readonly nature: "kpi";
      readonly statuts: readonly StatutPeriodeBrief[];
      /** Fin de la dernière période close mesurée : base de l'ancienneté. */
      readonly depuis: DateISO | null;
    }
  | {
      readonly nature: "atterrissage";
      readonly jours_budget: number;
      readonly jours_atterrissage: number;
    }
  | {
      readonly nature: "voyant";
      readonly voyant: "vert" | "orange" | "rouge" | "inconnu";
      /** Libellés français des motifs critiques (sans montant), du plus grave au moins grave. */
      readonly motifs: readonly string[];
      /** Date de la plus ancienne évaluation à l'origine d'un motif critique, si connue. */
      readonly depuis: DateISO | null;
    };

/** Élément candidat : un fait extrait par l'API, avant qualification par le moteur. */
export interface CandidatBrief {
  readonly type: TypeElementBrief;
  /** Identifiant de l'entité concernée (UUID) : jamais son contenu. */
  readonly entite_id: string;
  readonly mission_id: string | null;
  /** Libellé d'entité (numéro de facture, intitulé de pièce…) : jamais de contenu client. */
  readonly entite_libelle: string | null;
  readonly mission_libelle: string | null;
  /** Lien relatif interne vers l'écran concerné. */
  readonly lien: string;
  readonly faits: FaitsBrief;
  /** Donnée financière : fournie seulement à un utilisateur qui détient `finance.lire`. */
  readonly montant?: number | undefined;
  readonly devise?: string | undefined;
}

/** Élément du brief, qualifié par le moteur. */
export interface ElementBrief {
  readonly type: TypeElementBrief;
  readonly famille: FamilleBrief;
  readonly libelle: string;
  readonly entite_id: string;
  readonly mission_id: string | null;
  readonly mission_libelle: string | null;
  readonly lien: string;
  readonly gravite: GraviteBrief;
  readonly anciennete_jours: number;
  /** Atterrissage seulement : dépassement du budget en pourcentage, une décimale. */
  readonly ecart_pct?: number;
  /** Voyant de redressement seulement : motifs critiques, en texte, sans montant. */
  readonly motifs?: readonly string[];
  readonly montant?: number;
  readonly devise?: string;
}

/**
 * Source d'une famille : les candidats extraits (au plus un plafond par source) et le nombre de
 * lignes qui n'ont pas été extraites parce que le plafond était atteint.
 */
export interface SourceBrief {
  readonly famille: FamilleBrief;
  readonly candidats: readonly CandidatBrief[];
  /** Lignes existantes mais non extraites (plafond de la source) : comptées dans le total. */
  readonly restants: number;
  /**
   * La source n'a pas pu lire toutes ses lignes ET ne sait pas combien d'entre elles auraient
   * été retenues (filtre final en code, lecture bornée) : le total de la famille est alors un
   * minimum, jamais un nombre gonflé de lignes peut-être écartées. La famille est marquée
   * `tronque`.
   */
  readonly incomplet?: boolean;
}

export interface EntreeBrief {
  readonly date_reference: DateISO;
  readonly sources: readonly SourceBrief[];
  /** Éléments servis par famille (défaut : `LIMITE_PAR_FAMILLE_BRIEF`). */
  readonly limite_par_famille?: number;
}

export interface FamilleComposee {
  /** Nombre réel d'éléments de la famille, y compris ceux qui ne sont pas servis. */
  readonly total: number;
  /** Vrai si `elements` ne contient pas tous les éléments de la famille. */
  readonly tronque: boolean;
  readonly elements: readonly ElementBrief[];
}

export interface BriefCompose {
  readonly date_reference: DateISO;
  readonly familles: Readonly<Record<FamilleBrief, FamilleComposee>>;
  /** Total réel de toutes les familles. */
  readonly total: number;
  /** Rien à signaler : aucune famille n'a le moindre élément. */
  readonly vide: boolean;
}

export type CodeErreurBrief = "ENTREE_INVALIDE";

export class ErreurBrief extends Error {
  readonly code: CodeErreurBrief;

  constructor(code: CodeErreurBrief, message: string) {
    super(message);
    this.name = "ErreurBrief";
    this.code = code;
  }
}
