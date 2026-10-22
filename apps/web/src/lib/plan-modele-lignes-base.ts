/** Modèle financier du plan : forme des lignes des états et accesseurs des exercices. */
import type { FormatValeur } from "./plan-modele-format";
import type { ExercicePlan } from "./plan-modele-types";

export interface LigneEtat {
  cle: string;
  libelle: string;
  /** Code de poste SYSCOHADA révisé, INDICATIF. */
  code: string | null;
  format: FormatValeur;
  /** Solde ou total mis en évidence. */
  total?: boolean;
  /** Intertitre affiché avant la ligne (Actif, Passif…). */
  groupe?: string;
  valeur: (a: ExercicePlan) => number | null;
}

export interface EtatFinancier {
  cle: "compte_resultat" | "bilan" | "flux_tresorerie" | "indicateurs";
  titre: string;
  lignes: readonly LigneEtat[];
}

export const cr = (a: ExercicePlan) => a.compteResultat;
export const bi = (a: ExercicePlan) => a.bilan;
export const fl = (a: ExercicePlan) => a.fluxTresorerie;
export const ind = (a: ExercicePlan) => a.indicateurs;
