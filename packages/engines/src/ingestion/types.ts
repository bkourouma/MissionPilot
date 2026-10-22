/**
 * Types communs des moteurs d'ingestion de documents (lot 6, ADR-009).
 *
 * Le texte d'un document est une donnée CLIENT NON FIABLE : les moteurs le lisent, ne l'exécutent
 * jamais et bornent toutes leurs boucles (aucune expression régulière à retour arrière
 * catastrophique, lignes et pages plafonnées). Mêmes entrées, même sortie.
 */
import type { RoleLigneEtat, SectionEtatFinancier } from "../dossier/etat-financier";

/** Une page (ou une feuille) de texte extrait ; `numero` commence à 1. */
export interface PageTexte {
  readonly numero: number;
  readonly texte: string;
}

/** Motif pour lequel une ligne lue (règles ou IA) n'est pas retenue. */
export const MOTIFS_REJET_LIGNE = [
  "format",
  "page_inconnue",
  "section_inconnue",
  "code_invalide",
  "code_en_double",
  "parent_inconnu",
  "role_invalide",
  "montant_illisible",
  "montant_absent_de_la_page",
  "montants_ambigus",
  "libelle_ambigu",
  "donnee_financiere",
  "sous_total_non_rattache",
  "ligne_trop_longue",
  "trop_de_lignes",
] as const;
export type MotifRejetLigne = (typeof MOTIFS_REJET_LIGNE)[number];

/** Ligne d'état financier retenue : le montant se retrouve dans la page citée. */
export interface LigneEtatExtraite {
  readonly code: string;
  readonly libelle: string;
  readonly section: SectionEtatFinancier;
  /** Entier d'unités mineures de la devise (FCFA : l'unité ; EUR, USD : le centime). */
  readonly montant: number;
  readonly parent: string | null;
  readonly role: RoleLigneEtat | null;
  readonly page: number;
  /** Tableur seulement : numéro de ligne (1 = en-tête) et colonne (1 = A) du montant. */
  readonly ligne?: number;
  readonly colonne?: number;
}

export interface LigneRejetee {
  readonly page: number | null;
  /** Début de la ligne source (200 caractères au plus) pour l'écran de revue. */
  readonly texte: string;
  readonly motif: MotifRejetLigne;
}

export interface ExtractionEtat {
  readonly lignes: readonly LigneEtatExtraite[];
  readonly rejets: readonly LigneRejetee[];
}

/** Types d'élément d'une lecture de document (DD-02, DD-10) ; mêmes valeurs que `packages/shared`. */
export const TYPES_ELEMENT_LECTURE = ["fait", "risque", "chiffre", "engagement", "autre"] as const;
export type TypeElementLecture = (typeof TYPES_ELEMENT_LECTURE)[number];

export interface ElementLectureMoteur {
  readonly page: number;
  readonly type: TypeElementLecture;
  /** Extrait recopié de la page citée (400 caractères au plus). */
  readonly extrait: string;
  /** Énoncé du modèle (500 caractères au plus). */
  readonly enonce: string;
  /** Extrait et nombres retrouvés dans la page citée. */
  readonly verifie: boolean;
}

/** Même forme que `contenuLectureSchema` de `packages/shared`. */
export interface ContenuLectureMoteur {
  readonly resume: readonly { readonly page: number; readonly texte: string }[];
  readonly elements: readonly ElementLectureMoteur[];
  readonly tronque: false;
}

/** Types d'élément d'une proposition de standard (STD-13) ; mêmes valeurs que `packages/shared`. */
export const TYPES_ELEMENT_PROPOSITION = [
  "livrable",
  "item",
  "kpi_type",
  "initiative_type",
  "risque_type",
  "gabarit",
  "automatisation",
] as const;
export type TypeElementProposition = (typeof TYPES_ELEMENT_PROPOSITION)[number];

export interface EtapeProposee {
  readonly code: string;
  readonly libelle: string;
  readonly page: number;
}

export interface BriqueProposee {
  readonly etape_code: string;
  readonly code: string;
  readonly libelle: string;
  readonly objet: string;
  readonly page: number;
}

export interface ElementPropose {
  readonly type: TypeElementProposition;
  readonly code: string;
  readonly libelle: string;
  readonly description: string | null;
  readonly page: number;
}

export interface RubriqueProposee {
  readonly code: string;
  readonly libelle: string;
  /** Exactement cinq niveaux, du plus faible au plus fort. */
  readonly niveaux: readonly string[];
  readonly page: number;
}

/** Même forme que `contenuPropositionSchema` de `packages/shared`. */
export interface ContenuPropositionMoteur {
  readonly etapes: readonly EtapeProposee[];
  readonly briques: readonly BriqueProposee[];
  readonly elements: readonly ElementPropose[];
  readonly rubriques: readonly RubriqueProposee[];
  readonly tronque: false;
}
