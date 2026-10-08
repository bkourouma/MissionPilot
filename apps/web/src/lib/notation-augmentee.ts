import type { Resultat } from "./saisie";
import type { Classe, TonaliteNotation } from "./notation";

/*
 * Notation augmentée (PRD complémentaire §11.1) côté interface : types des réponses de l'API,
 * chemins, libellés et lecture des paramètres d'URL. Aucun chiffre n'est calculé ici : indice
 * de confiance, contributions, simulation, mesures de calibration et priorités viennent de
 * l'API (moteurs). Les fonctions ne font que présenter.
 */

const segment = encodeURIComponent;

export type NiveauConfiance = "elevee" | "suffisante" | "insuffisante";

export interface ConfianceNotation {
  numero: number;
  statut: string;
  indice: number;
  seuil: number;
  publiable: boolean;
  niveau: NiveauConfiance;
  couverture: { valeur: number; poids: number };
  repondants: { valeur: number; poids: number; nombre: number; cible: number };
  preuves: {
    valeur: number;
    poids: number;
    dimensions_etayees: number;
    dimensions: number;
    assertions: number;
  };
}

export interface ConstatPerception {
  question: string;
  libelle: string;
  type: "entre_populations" | "interne";
  gravite: "majeur" | "notable";
  ecart: number;
  niveau_bas: number;
  niveau_haut: number;
  populations_basses: string[];
  populations_hautes: string[];
  nombre_repondants: number;
  enonce: string;
}

export interface ConstatsNotation {
  numero: number;
  statut: string;
  constats: ConstatPerception[];
}

export interface ContributionPratique {
  indicateur: string;
  question: string;
  statut: "repondu" | "manquant" | "sans_objet";
  points: number | null;
  poids: number;
  contribution: number;
}

export interface ContributionDimension {
  dimension: string;
  libelle: string;
  notable: boolean;
  poids: number;
  score: number | null;
  contribution: number;
  ajustement: number;
  ecart_arrondi: number;
  pratiques: ContributionPratique[];
}

export interface EtapeSimulation {
  dimension: string;
  libelle: string;
  indicateur: string;
  question: string;
  points_avant: number;
  points_apres: number;
  paliers: number;
  gain: number;
}

export interface SimulationPassage {
  classe_actuelle: Classe;
  score_actuel: number;
  cible: Classe;
  seuil: number;
  deja_atteinte: boolean;
  atteignable: boolean;
  gain_necessaire: number;
  score_projete: number;
  classe_projetee: Classe;
  /** Vrai si le plafond de pas a interrompu la simulation avant la cible. */
  tronquee?: boolean;
  etapes: EtapeSimulation[];
}

export interface ExplicationNotation {
  numero: number;
  statut: string;
  score: number;
  classe: Classe;
  strategie: "ignorer" | "penaliser";
  somme_contributions: number;
  dimensions: ContributionDimension[];
  simulation: SimulationPassage | null;
}

export type SourceImpact = "contexte_semblable" | "secteur" | "taille" | "general" | "aucun";

export interface InitiativePriorisee {
  code: string;
  titre: string;
  rang: number;
  priorite: number;
  besoin: number;
  impact: number;
  source_impact: SourceImpact;
  observations: number;
  effort: number;
  duree_mois: number;
  dimensions: string[];
  retenue: boolean;
  motif: string;
}

export interface PlanActionPropose {
  version_id: string;
  numero: number;
  contexte: { secteur: string | null; taille: string | null };
  capacite: number;
  capacite_utilisee: number;
  initiatives: InitiativePriorisee[];
}

export interface ElementBanque {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  intitule: string | null;
  version_validee: number | null;
  modifie_le: string;
}

export interface ElementCalibration {
  id: string;
  titre: string;
  nombre_cas: number;
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_le: string;
  cloturee_le: string | null;
  close: boolean;
  evaluateurs: number;
}

export interface Page<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/* ----- Chemins ----- */

export const cheminConfiance = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/confiance?version=${numero}`;
export const cheminConstats = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/constats?version=${numero}`;
export const cheminExplication = (notationId: string, numero: number, cible: Classe | null) =>
  `/api/notations/${segment(notationId)}/explication?version=${numero}${cible ? `&cible=${cible}` : ""}`;
export const cheminPropositionPlan = (notationId: string, numero: number, capacite: number) =>
  `/api/notations/${segment(notationId)}/plan-action/proposition?version=${numero}&capacite=${capacite}`;
export const cheminPlansAction = (notationId: string) =>
  `/api/notations/${segment(notationId)}/plans-action`;
export const cheminBanque = (curseur: string, statut: "brouillon" | "valide" | null) => {
  const q = new URLSearchParams({ limite: "50" });
  if (curseur) q.set("curseur", curseur);
  if (statut) q.set("statut", statut);
  return `/api/notation/banque?${q.toString()}`;
};
export const cheminCalibrations = (curseur: string) =>
  `/api/notation/calibrations?limite=50${curseur ? `&curseur=${segment(curseur)}` : ""}`;
export const hrefAnalyseNotation = (missionId: string, numero?: number | null) =>
  `/missions/${segment(missionId)}/notation/analyse${numero ? `?version=${numero}` : ""}`;

/* ----- Paramètres d'URL ----- */

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Classe visée du simulateur (A à D), sinon null (l'API vise la classe supérieure). */
export function lireCible(v: string | string[] | undefined): Classe | null {
  const x = premier(v);
  return x === "A" || x === "B" || x === "C" || x === "D" ? x : null;
}

export const CAPACITE_DEFAUT = 10;

/** Capacité du client (somme d'efforts, 1 à 100), sinon la valeur par défaut. */
export function lireCapacite(v: string | string[] | undefined): number {
  const x = Number(premier(v));
  return Number.isInteger(x) && x >= 1 && x <= 100 ? x : CAPACITE_DEFAUT;
}

/** Statut de filtre de la banque. */
export function lireStatutBanque(v: string | string[] | undefined): "brouillon" | "valide" | null {
  const x = premier(v);
  return x === "brouillon" || x === "valide" ? x : null;
}

/** Saisie de la capacité avant l'enregistrement d'un plan. */
export function validerCapacite(saisie: string): Resultat<{ capacite: number }, "capacite"> {
  const x = Number(saisie.trim());
  if (saisie.trim() === "" || !Number.isInteger(x) || x < 1 || x > 100) {
    return { ok: false, erreurs: { capacite: "Entier de 1 à 100 attendu." } };
  }
  return { ok: true, charge: { capacite: x } };
}

/* ----- Libellés et présentation ----- */

export const NIVEAUX_CONFIANCE: Record<
  NiveauConfiance,
  { libelle: string; tonalite: TonaliteNotation }
> = {
  elevee: { libelle: "Confiance élevée", tonalite: "succes" },
  suffisante: { libelle: "Confiance suffisante", tonalite: "attention" },
  insuffisante: { libelle: "Confiance insuffisante : publication impossible", tonalite: "danger" },
};

export const GRAVITES_CONSTAT: Record<
  ConstatPerception["gravite"],
  { libelle: string; tonalite: TonaliteNotation }
> = {
  majeur: { libelle: "Écart majeur", tonalite: "danger" },
  notable: { libelle: "Écart notable", tonalite: "attention" },
};

export const SOURCES_IMPACT: Record<SourceImpact, string> = {
  contexte_semblable: "Contextes semblables (secteur et taille)",
  secteur: "Même secteur",
  taille: "Même taille",
  general: "Tous contextes",
  aucun: "Aucune observation",
};

/** Ratio 0-1 affiché en pour-cent entier (« 81 % »). */
export function formaterRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)} %`;
}

/**
 * Points signés au centième, en français (« +3,50 », « −1,20 », « 0,00 ») : arrondi d'abord, signe
 * ensuite (un écart de −0,004 s'affiche « 0,00 », jamais « −0,00 »).
 */
export function formaterPointsSignes(v: number): string {
  const centiemes = Math.round(Math.abs(v) * 100);
  const absolu = (centiemes / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (centiemes === 0) return absolu;
  return v > 0 ? `+${absolu}` : `−${absolu}`;
}

/** Phrase de synthèse du simulateur. */
export function phraseSimulation(s: SimulationPassage): string {
  if (s.deja_atteinte) return `La classe ${s.cible} est déjà atteinte.`;
  if (s.tronquee) {
    return `La simulation a été interrompue (trop de paliers à relever) avant la classe ${s.cible} : score projeté ${s.score_projete.toLocaleString("fr-FR")}, résultat partiel.`;
  }
  if (!s.atteignable) {
    return `La classe ${s.cible} n'est pas atteignable en relevant les seules pratiques répondues : score projeté ${s.score_projete.toLocaleString("fr-FR")}.`;
  }
  const n = s.etapes.length;
  return `Pour passer de ${s.classe_actuelle} à ${s.cible} (seuil ${s.seuil}), relever ${n} pratique${n > 1 ? "s" : ""} : score projeté ${s.score_projete.toLocaleString("fr-FR")} (classe ${s.classe_projetee}).`;
}
