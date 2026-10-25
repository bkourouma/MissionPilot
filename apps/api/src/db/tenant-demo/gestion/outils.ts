import { attendre } from "../contexte.js";
import type { AffectationLue, MissionLue } from "./casting.js";

/*
 * Petits outils communs aux modules de la phase `gestion` (propriétaire : chef de lot 2b ; les
 * modules de domaine l'importent, ne le modifient pas).
 */

/** `attendre` de seed-demo.ts : lève avec le corps de la réponse si le statut diffère. */
export const ok = attendre;

/** Plus petite des dates ISO (les chaînes ISO se comparent lexicalement). */
export const minDate = (...d: string[]): string => d.reduce((a, b) => (a < b ? a : b));
/** Plus grande des dates ISO. */
export const maxDate = (...d: string[]): string => d.reduce((a, b) => (a > b ? a : b));

/** Arrondi au demi-jour (pas de saisie du cabinet : `demi_journee`). */
export const demiJour = (jours: number): number => Math.round(jours * 2) / 2;

/** Part (0 à 1) de la fenêtre [debut ; fin] écoulée à la date `date`. */
export function avancement(debut: string, fin: string, date: string): number {
  const d = Date.parse(debut);
  const f = Date.parse(fin);
  if (f <= d) return 1;
  return Math.min(1, Math.max(0, (Date.parse(date) - d) / (f - d)));
}

/** Affectations d'une mission qui ont un compte (donc qui peuvent saisir leurs temps). */
export const affectationsAvecCompte = (
  m: MissionLue,
): (AffectationLue & { utilisateurId: string })[] =>
  m.affectations.filter((a): a is AffectationLue & { utilisateurId: string } => !!a.utilisateurId);
