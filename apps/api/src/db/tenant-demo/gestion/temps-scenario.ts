import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { lundiDe, type Alea } from "../horloge.js";
import { MOTIFS_REJET, PROBA_SOUMISSION_TARDIVE } from "./donnees-temps.js";
import { minDate } from "./outils.js";
import type { FeuillePlan } from "./temps-plan.js";

/*
 * Chronologie des feuilles de temps du Tenant démo : état final voulu (validée, soumise ou
 * brouillon selon l'âge de la semaine), dates de soumission, de rejet et de décision, utilisées
 * pour l'antédatage (temps-saisie.ts).
 */

export type StatutFinal = "validee" | "soumise" | "brouillon";

export interface Scenario {
  final: StatutFinal;
  /** Motif du rejet programmé (la feuille est rejetée une fois, corrigée, resoumise, validée). */
  rejet: string | null;
  /** Validation partielle : seul le chef de mission décide sa partie (feuille encore soumise). */
  partielle: boolean;
  t1: string;
  tRejet: string;
  tResoumission: string;
  tDecision: string;
}

export const heure = (date: string, rng: Alea, h1 = 8, h2 = 18): string =>
  `${date}T${String(rng.entier(h1, h2)).padStart(2, "0")}:${String(rng.entier(0, 59)).padStart(2, "0")}:00Z`;

/** Chronologie d'une feuille : soumission, rejet éventuel, décision (jamais après aujourd'hui). */
export function scenarioFeuille(
  env: { ctx: ContexteTenantDemo; rng: Alea },
  plan: FeuillePlan,
  options: { rejet: string | null; tard: boolean },
): Scenario {
  const { ctx } = env;
  const rng = env.rng.deriver(`scenario|${plan.cle}|${plan.semaine}`);
  const courant = lundiDe(ctx.aujourdhui);
  const precedent = ajouterJours(courant, -7);
  let final: StatutFinal = "validee";
  if (plan.semaine === courant) final = rng.proba(0.6) ? "soumise" : "brouillon";
  else if (plan.semaine === precedent) {
    const r = rng.suivant();
    final = r < 0.05 ? "validee" : r < 0.9 ? "soumise" : "brouillon";
  }
  const tard = options.tard || (final === "validee" && rng.proba(PROBA_SOUMISSION_TARDIVE));
  const jourSoumission = tard
    ? ajouterJours(plan.semaine, 7 + rng.entier(0, 2))
    : ajouterJours(plan.semaine, rng.choisir([3, 4, 4, 4, 4]));
  const borne = (d: string): string => minDate(d, ctx.aujourdhui);
  const j1 = borne(jourSoumission);
  const jRejet = borne(ajouterJours(j1, rng.entier(1, 2)));
  const jReso = borne(ajouterJours(jRejet, rng.entier(0, 1)));
  const jDecision = borne(ajouterJours(options.rejet ? jReso : j1, rng.entier(1, 5)));
  return {
    final,
    rejet: options.rejet,
    partielle: final === "soumise" && plan.semaine === precedent && plan.interne && rng.proba(0.3),
    t1: heure(j1, rng, 14, 18),
    tRejet: heure(jRejet, rng, 9, 12),
    tResoumission: heure(jReso, rng, 14, 18),
    tDecision: heure(jDecision, rng, 9, 17),
  };
}

/** Tire le motif de rejet d'une feuille (indexé pour varier). */
export const motifRejet = (rng: Alea): string => rng.choisir(MOTIFS_REJET);
