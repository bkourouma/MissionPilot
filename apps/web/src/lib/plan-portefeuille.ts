/**
 * Priorisation du portefeuille d'initiatives (PLA-14) : types de la réponse de l'API, contrôle
 * des saisies (évaluation, contraintes, arbitrage), écarts à motiver, chemins et messages.
 * Logique pure, testée dans `plan-portefeuille.test.ts`.
 *
 * Scores, sélection optimale et totaux sortent du moteur côté API (`optimiserPortefeuille`) ;
 * l'arbitrage reste humain : chaque écart à la proposition exige un motif (refusé sinon par
 * l'API et par la base).
 */
import { ErreurApi, messageErreur } from "./api";
import type { Devise } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";
import { lireMontant, lireNombre } from "./saisie";

export interface EvaluationPortefeuille {
  version: number;
  valeur: number;
  effort: number;
  risque: number;
  charge_jours: number;
  commentaire: string | null;
  auteur_id: string;
  cree_le: string;
  score: number;
}

export interface InitiativePortefeuille {
  id: string;
  titre: string;
  statut: string | null;
  statut_contenu: string;
  budget: number | null;
  responsable_id: string | null;
  evaluation: EvaluationPortefeuille | null;
}

export interface Portefeuille {
  plan_id: string;
  devise: Devise;
  poids_defaut: Poids;
  initiatives: InitiativePortefeuille[];
  dernier_arbitrage: {
    id: string;
    retenues: string[];
    decideur_nom: string;
    decide_le: string;
  } | null;
}

export interface Poids {
  valeur: number;
  effort: number;
  risque: number;
}

export type MotifMoteur =
  "obligatoire" | "optimisation" | "exclue" | "depend_d_une_exclue" | "contraintes" | "score_nul";

export interface Proposition {
  decisions: { id: string; score: number; retenue: boolean; motif: MotifMoteur }[];
  retenues: string[];
  totaux: { score: number; cout: number; charge: number };
  realisable: boolean;
  optimal: boolean;
  noeuds_explores: number;
  poids: Poids;
}

export interface ReponseProposition {
  plan_id: string;
  moteur: string;
  contraintes: unknown;
  proposition: Proposition;
  non_evaluees: string[];
}

export interface Arbitrage {
  id: string;
  contraintes: Record<string, unknown>;
  proposition: Proposition;
  retenues: string[];
  motifs: { initiative_id: string; motif: string }[];
  commentaire: string | null;
  decideur_nom: string;
  decide_le: string;
}

const MOTIFS: Record<MotifMoteur, string> = {
  obligatoire: "Retenue d'office (obligatoire ou en cours)",
  optimisation: "Retenue par l'optimisation",
  exclue: "Exclue",
  depend_d_une_exclue: "Dépend d'une initiative exclue",
  contraintes: "Écartée : budget ou capacité insuffisants",
  score_nul: "Écartée : score nul",
};
export const libelleMotifMoteur = (m: string) => MOTIFS[m as MotifMoteur] ?? "Décision du moteur";

/* ----- Évaluation ----- */

export interface SaisieEvaluation {
  valeur: string;
  effort: string;
  risque: string;
  charge_jours: string;
  commentaire: string;
}

export const OPTIONS_NOTE = ["1", "2", "3", "4", "5"].map((v) => ({ valeur: v, libelle: v }));

export function saisieEvaluation(e: EvaluationPortefeuille | null): SaisieEvaluation {
  return e
    ? {
        valeur: String(e.valeur),
        effort: String(e.effort),
        risque: String(e.risque),
        charge_jours: String(e.charge_jours),
        commentaire: e.commentaire ?? "",
      }
    : { valeur: "", effort: "", risque: "", charge_jours: "", commentaire: "" };
}

const note = (v: string) => (/^[1-5]$/.test(v) ? Number(v) : null);

function entier(v: string, max: number): number | null {
  const n = lireNombre(v);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

export function validerEvaluation(s: SaisieEvaluation) {
  const erreurs: Partial<Record<keyof SaisieEvaluation, string>> = {};
  const valeur = note(s.valeur);
  const effort = note(s.effort);
  const risque = note(s.risque);
  if (valeur === null) erreurs.valeur = "Note de 1 à 5.";
  if (effort === null) erreurs.effort = "Note de 1 à 5.";
  if (risque === null) erreurs.risque = "Note de 1 à 5.";
  const charge = entier(s.charge_jours, 100_000);
  if (charge === null) erreurs.charge_jours = "Nombre entier de jours-homme.";
  if (s.commentaire.trim().length > 1000) erreurs.commentaire = "1 000 caractères au plus.";
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      valeur,
      effort,
      risque,
      charge_jours: charge,
      commentaire: s.commentaire.trim() || null,
    },
  };
}

/* ----- Contraintes ----- */

export interface SaisieContraintes {
  budget_max: string;
  capacite_max: string;
  poids_valeur: string;
  poids_effort: string;
  poids_risque: string;
  obligatoires: string[];
  exclues: string[];
}

export function saisieContraintes(poids: Poids): SaisieContraintes {
  return {
    budget_max: "",
    capacite_max: "",
    poids_valeur: String(poids.valeur),
    poids_effort: String(poids.effort),
    poids_risque: String(poids.risque),
    obligatoires: [],
    exclues: [],
  };
}

export function validerContraintes(s: SaisieContraintes, devise: Devise) {
  const erreurs: Partial<Record<keyof SaisieContraintes, string>> = {};
  const budget = lireMontant(s.budget_max, devise);
  if (Number.isNaN(budget)) erreurs.budget_max = "Montant invalide.";
  const capacite = s.capacite_max.trim() === "" ? null : entier(s.capacite_max, 10_000_000);
  if (s.capacite_max.trim() !== "" && capacite === null) {
    erreurs.capacite_max = "Nombre entier de jours-homme.";
  }
  const poids = {
    valeur: entier(s.poids_valeur, 10),
    effort: entier(s.poids_effort, 10),
    risque: entier(s.poids_risque, 10),
  };
  if (poids.valeur === null || poids.effort === null || poids.risque === null) {
    erreurs.poids_valeur = "Poids entiers de 0 à 10.";
  } else if (poids.valeur === 0 && poids.effort === 0 && poids.risque === 0) {
    erreurs.poids_valeur = "Au moins un poids non nul.";
  }
  if (s.obligatoires.some((id) => s.exclues.includes(id))) {
    erreurs.exclues = "Une initiative n'est pas à la fois obligatoire et exclue.";
  }
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      budget_max: budget,
      capacite_max: capacite,
      poids,
      obligatoires: s.obligatoires,
      exclues: s.exclues,
    },
  };
}

/* ----- Arbitrage ----- */

/** Initiatives dont la décision humaine s'écarte de la proposition (motif exigé). */
export function ecartsArbitrage(
  proposition: Pick<Proposition, "decisions" | "retenues">,
  choisies: readonly string[],
): string[] {
  const proposees = new Set(proposition.retenues);
  const retenues = new Set(choisies);
  return proposition.decisions
    .map((d) => d.id)
    .filter((id) => proposees.has(id) !== retenues.has(id));
}

/** Corps de l'arbitrage ; erreur si un écart n'a pas de motif. */
export function validerArbitrage(
  contraintes: Record<string, unknown>,
  proposition: Pick<Proposition, "decisions" | "retenues">,
  choisies: readonly string[],
  motifs: Readonly<Record<string, string>>,
  commentaire: string,
) {
  const ecarts = ecartsArbitrage(proposition, choisies);
  const manquants = ecarts.filter((id) => !(motifs[id] ?? "").trim());
  if (manquants.length) return { manquants, corps: null };
  return {
    manquants,
    corps: {
      contraintes,
      retenues: [...choisies],
      motifs: ecarts.map((id) => ({ initiative_id: id, motif: (motifs[id] as string).trim() })),
      ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}),
    },
  };
}

export const MESSAGE_MOTIF_REQUIS =
  "Le motif de cet écart à la proposition du moteur est obligatoire.";

/** Erreur à afficher sous chaque champ « Motif » manquant (initiative → message). */
export function erreursMotifs(manquants: readonly string[]): Record<string, string> {
  return Object.fromEntries(manquants.map((id) => [id, MESSAGE_MOTIF_REQUIS]));
}

/** Erreur d'un motif : retirée dès que le motif n'est plus vide (sans attendre un nouvel envoi). */
export function erreurMotif(
  erreurs: Readonly<Record<string, string>>,
  motifs: Readonly<Record<string, string>>,
  id: string,
): string | undefined {
  return erreurs[id] && !(motifs[id] ?? "").trim() ? erreurs[id] : undefined;
}

/** Message français d'un refus. */
export function messagePortefeuille(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "MOTIF_REQUIS") return "Chaque écart à la proposition du moteur exige un motif.";
    if (e.code === "TROP_DE_PROPOSITIONS") {
      return "Trop de propositions calculées en peu de temps : patientez quelques minutes avant de recommencer.";
    }
    if (e.statut === 403) {
      return "Arbitrer le portefeuille est réservé aux responsables de la mission qui valident le plan.";
    }
    if (e.statut === 404)
      return "Ce plan ou cette initiative est introuvable ou ne vous est plus accessible.";
    if (e.statut === 409) return e.message;
    if (e.statut === 400 && e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") {
      return e.message;
    }
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const hrefPortefeuille = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/portefeuille`;
export const cheminPortefeuille = (planId: string) => `${cheminPlan(planId)}/portefeuille`;
export const cheminEvaluation = (planId: string, initiativeId: string) =>
  `${cheminPortefeuille(planId)}/initiatives/${seg(initiativeId)}`;
export const cheminProposition = (planId: string) => `${cheminPortefeuille(planId)}/proposition`;
export const cheminArbitrages = (planId: string, limite = 10) =>
  `${cheminPortefeuille(planId)}/arbitrages?limite=${limite}`;
export const cheminArbitrer = (planId: string) => `${cheminPortefeuille(planId)}/arbitrages`;
