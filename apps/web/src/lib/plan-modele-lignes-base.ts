/** Modèle financier du plan : forme des lignes des états et accesseurs des exercices. */
import type { Langue } from "@missionpilot/shared";
import type { FormatValeur } from "./plan-modele-format";
import type { ExercicePlan } from "./plan-modele-types";

export interface LigneEtat {
  cle: string;
  libelle: string;
  /** Libellé anglais (le français reste la référence). */
  libelleEn?: string;
  /** Code de poste SYSCOHADA révisé, INDICATIF. */
  code: string | null;
  format: FormatValeur;
  /** Solde ou total mis en évidence. */
  total?: boolean;
  /** Intertitre affiché avant la ligne (Actif, Passif…). */
  groupe?: string;
  groupeEn?: string;
  valeur: (a: ExercicePlan) => number | null;
}

export interface EtatFinancier {
  cle: "compte_resultat" | "bilan" | "flux_tresorerie" | "indicateurs";
  titre: string;
  titreEn?: string;
  lignes: readonly LigneEtat[];
}

export const libelleLigne = (l: LigneEtat, langue: Langue = "fr") =>
  langue === "en" ? (l.libelleEn ?? l.libelle) : l.libelle;
export const groupeLigne = (l: LigneEtat, langue: Langue = "fr") =>
  langue === "en" ? (l.groupeEn ?? l.groupe) : l.groupe;
export const titreEtat = (e: EtatFinancier, langue: Langue = "fr") =>
  langue === "en" ? (e.titreEn ?? e.titre) : e.titre;

export const cr = (a: ExercicePlan) => a.compteResultat;
export const bi = (a: ExercicePlan) => a.bilan;
export const fl = (a: ExercicePlan) => a.fluxTresorerie;
export const ind = (a: ExercicePlan) => a.indicateurs;
