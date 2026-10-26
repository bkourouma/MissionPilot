import type { FiabilitePreuve, TypeSourcePreuve } from "@missionpilot/shared";
import type { MissionCasting } from "./casting.js";

/*
 * Types et plan commun du registre de preuves des missions notées (étape « preuves-notation »).
 *
 * Les six preuves d'une mission ont un TYPE DE SOURCE fixé par leur position, de sorte que chaque
 * dimension de la grille s'appuie sur deux preuves de types distincts (triangulation, PRV-02) :
 *   0 document · 1 entretien · 2 observation · 3 questionnaire · 4 document · 5 donnée externe.
 * Les données (preuves-notation-donnees-*.ts) ne portent que ce qui change d'une mission à l'autre :
 * extraits, fiabilités, énoncés, dimension partiellement étayée et dimension sans affirmation.
 */

/** Dimensions de la grille de notation (les mêmes pour les deux grilles du cabinet). */
export const DIMENSIONS_GRILLE = [
  "strategie",
  "processus",
  "pilotage",
  "amelioration",
  "organisation",
  "engagement",
  "qualite",
  "couts",
  "innovation",
  "positionnement",
] as const;
export type DimensionGrille = (typeof DIMENSIONS_GRILLE)[number];

export const TYPES_PAR_POSITION: readonly TypeSourcePreuve[] = [
  "document",
  "entretien",
  "observation",
  "questionnaire",
  "document",
  "donnee_externe",
];

/** Positions des deux preuves (de types distincts) qui étayent chaque dimension. */
export const PREUVES_PAR_DIMENSION: Readonly<Record<DimensionGrille, readonly [number, number]>> = {
  strategie: [0, 1],
  processus: [2, 4],
  pilotage: [0, 1],
  amelioration: [2, 4],
  organisation: [1, 3],
  engagement: [1, 3],
  qualite: [0, 2],
  couts: [0, 5],
  innovation: [2, 5],
  positionnement: [3, 5],
};

/** Dimensions pouvant n'être étayées que par une preuve fragile (position 3 ou 5, fiabilité C). */
export const DIMENSIONS_PARTIELLES_POSSIBLES: readonly DimensionGrille[] = [
  "organisation",
  "engagement",
  "couts",
  "innovation",
  "positionnement",
];

export type Redacteur = "chef" | "consultant" | "consultant.2";

/** Qui enregistre la preuve de chaque position (le chef recueille les entretiens). */
export const REDACTEURS_PAR_POSITION: readonly Redacteur[] = [
  "consultant",
  "chef",
  "consultant.2",
  "consultant",
  "consultant.2",
  "consultant",
];

export interface DefPreuveNotation {
  source: string;
  extrait: string;
  fiabilite: FiabilitePreuve;
  /** Date de la preuve : fraction (0 à 1) de la période de la mission. */
  f: number;
}

export interface DefAssertionNotation {
  enonce: string;
  classe: "R1" | "R2";
}

export interface DefRegistreNotation {
  mission: MissionCasting;
  /** Code de la grille de la notation de la mission (dimensions lues en base). */
  grille: string;
  preuves: readonly [
    DefPreuveNotation,
    DefPreuveNotation,
    DefPreuveNotation,
    DefPreuveNotation,
    DefPreuveNotation,
    DefPreuveNotation,
  ];
  /** Une affirmation par dimension, sauf `sans`. */
  assertions: Readonly<Partial<Record<DimensionGrille, DefAssertionNotation>>>;
  /** Dimension étayée par une seule preuve (la dernière de sa paire, fiabilité C attendue). */
  partielle: DimensionGrille;
  /** Dimension sans affirmation (aucune affirmation créée). */
  sans: DimensionGrille;
}
