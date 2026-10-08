/**
 * Scénarios base, optimiste et pessimiste (PLA-07) : chaque scénario applique
 * des écarts aux hypothèses du scénario de base, puis recalcule le modèle
 * complet.
 *
 * Écarts (tous facultatifs, nuls par défaut) :
 * - `croissanceChiffreAffaires`, `tauxMargeBrute`, `tauxChargesVariables` :
 *   points ajoutés à chaque année (−5 : 10 % devient 5 %) ;
 * - `chargesFixes` : variation relative en points (+5 : charges × 1,05,
 *   arrondi par année) ;
 * - `delaiClientsJours` : jours ajoutés au délai de paiement des clients.
 *
 * Une hypothèse qui sort de ses bornes après écart est refusée
 * (`HYPOTHESE_INVALIDE`, message préfixé du scénario) : elle n'est jamais
 * plafonnée en silence.
 */
import { ErreurPlan } from "./erreurs";
import { appliquer, sommeDecimale, unPlus, versEntier } from "./exact";
import {
  normaliserHypotheses,
  validerHypotheses,
  type HypothesesNormalisees,
  type HypothesesPlan,
} from "./hypotheses";
import { calculerDepuisNormalisees, type ResultatPlanFinancier } from "./modele";

export type NomScenario = "base" | "optimiste" | "pessimiste";

export interface EcartsScenario {
  readonly croissanceChiffreAffaires?: number;
  readonly tauxMargeBrute?: number;
  readonly tauxChargesVariables?: number;
  readonly chargesFixes?: number;
  readonly delaiClientsJours?: number;
}

export interface EcartsScenarios {
  readonly optimiste: EcartsScenario;
  readonly pessimiste: EcartsScenario;
}

/** Écarts de départ, à ajuster par le consultant mission par mission. */
export const ECARTS_SCENARIOS_DEFAUT: EcartsScenarios = {
  optimiste: { croissanceChiffreAffaires: 5, tauxMargeBrute: 2, chargesFixes: -5 },
  pessimiste: {
    croissanceChiffreAffaires: -5,
    tauxMargeBrute: -2,
    chargesFixes: 5,
    delaiClientsJours: 15,
  },
};

export interface SyntheseScenario {
  readonly scenario: NomScenario;
  readonly chiffreAffairesFinal: number;
  readonly resultatNetCumule: number;
  readonly tresorerieFinale: number;
  readonly valeurActuelleNette: number;
  readonly tauxRendementInterne: number | null;
  readonly nombreAlertes: number;
}

export interface ResultatScenarios {
  readonly base: ResultatPlanFinancier;
  readonly optimiste: ResultatPlanFinancier;
  readonly pessimiste: ResultatPlanFinancier;
  readonly ecarts: EcartsScenarios;
  readonly synthese: readonly SyntheseScenario[];
}

function ecartValide(nom: string, champ: string, x: number | undefined, min = -Infinity): number {
  const v = x ?? 0;
  if (!Number.isFinite(v) || v <= min) {
    throw new ErreurPlan(
      "HYPOTHESE_INVALIDE",
      `Scénario ${nom} : écart ${champ} invalide (reçu ${v}).`,
      `ecarts.${nom}.${champ}`,
    );
  }
  return v;
}

/** Applique des écarts à des hypothèses normalisées, puis les revalide. */
export function appliquerEcarts(
  h: HypothesesNormalisees,
  ecarts: EcartsScenario,
  nom: string,
): HypothesesNormalisees {
  const croissance = ecartValide(
    nom,
    "croissanceChiffreAffaires",
    ecarts.croissanceChiffreAffaires,
  );
  const marge = ecartValide(nom, "tauxMargeBrute", ecarts.tauxMargeBrute);
  const variables = ecartValide(nom, "tauxChargesVariables", ecarts.tauxChargesVariables);
  const fixes = ecartValide(nom, "chargesFixes", ecarts.chargesFixes, -100);
  const clients = ecartValide(nom, "delaiClientsJours", ecarts.delaiClientsJours);
  const plus = sommeDecimale;
  const facteurFixes = unPlus(fixes);
  const ajustees: HypothesesNormalisees = {
    ...h,
    croissanceChiffreAffaires: h.croissanceChiffreAffaires.map((g) => plus(g, croissance)),
    tauxMargeBrute: h.tauxMargeBrute.map((m) => plus(m, marge)),
    tauxChargesVariables: h.tauxChargesVariables.map((v) => plus(v, variables)),
    chargesFixes: h.chargesFixes.map((c) => versEntier(appliquer(BigInt(c), facteurFixes))),
    delaiClientsJours: h.delaiClientsJours.map((j) => plus(j, clients)),
  };
  try {
    validerHypotheses(ajustees);
  } catch (e) {
    // validerHypotheses ne lève que des ErreurPlan.
    const erreur = e as ErreurPlan;
    throw new ErreurPlan(erreur.code, `Scénario ${nom} : ${erreur.message}`, erreur.chemin);
  }
  return ajustees;
}

function synthetiser(scenario: NomScenario, r: ResultatPlanFinancier): SyntheseScenario {
  return {
    scenario,
    chiffreAffairesFinal: r.synthese.chiffreAffairesFinal,
    resultatNetCumule: r.synthese.resultatNetCumule,
    tresorerieFinale: r.synthese.tresorerieFinale,
    valeurActuelleNette: r.synthese.valeurActuelleNette,
    tauxRendementInterne: r.synthese.tauxRendementInterne,
    nombreAlertes: r.alertes.length,
  };
}

/** Calcule les trois scénarios à partir des hypothèses de base. */
export function calculerScenariosPlan(
  hypotheses: HypothesesPlan,
  ecarts: EcartsScenarios = ECARTS_SCENARIOS_DEFAUT,
): ResultatScenarios {
  const base = normaliserHypotheses(hypotheses);
  const resultats = {
    base: calculerDepuisNormalisees(base),
    optimiste: calculerDepuisNormalisees(appliquerEcarts(base, ecarts.optimiste, "optimiste")),
    pessimiste: calculerDepuisNormalisees(appliquerEcarts(base, ecarts.pessimiste, "pessimiste")),
  };
  return {
    ...resultats,
    ecarts,
    synthese: [
      synthetiser("base", resultats.base),
      synthetiser("optimiste", resultats.optimiste),
      synthetiser("pessimiste", resultats.pessimiste),
    ],
  };
}
