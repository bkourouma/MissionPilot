import { ajouterJours } from "@missionpilot/engines";
import { ecartJours, estWeekEnd } from "../horloge.js";

/*
 * Calendrier des tâches d'une mission du casting : fonctions pures. Les phases se partagent la
 * période de la mission au prorata de leurs jours budgétés ; dans une phase, les tâches sont
 * échelonnées (début décalé, durée commune). Les dates exactes (jours fériés) sont recalculées
 * par le moteur de planification de l'API (`/api/missions/:id/planning`) : ici, on propose un
 * début souhaité et une durée en jours ouvrés prudente, pour que tout reste dans la mission.
 */

export interface TacheACalendrier {
  id: string;
  jours: number;
}

export interface PhaseACalendrier {
  id: string;
  taches: TacheACalendrier[];
}

export interface PlacementTache {
  debut: string;
  /** Durée en jours ouvrés. */
  duree: number;
}

/** Premier jour ouvré (lundi à vendredi) à partir de `date` incluse. */
export function jourOuvre(date: string): string {
  let d = date;
  while (estWeekEnd(d)) d = ajouterJours(d, 1);
  return d;
}

/** `date` avancée de `n` jours ouvrés (week-ends ignorés, jours fériés non connus ici). */
export function ajouterOuvres(date: string, n: number): string {
  let d = jourOuvre(date);
  for (let i = 0; i < n; i++) d = jourOuvre(ajouterJours(d, 1));
  return d;
}

/** Nombre de jours ouvrés (week-ends exclus) de `debut` à `fin` incluses. */
export function joursOuvres(debut: string, fin: string): number {
  let n = 0;
  for (let d = debut; d <= fin; d = ajouterJours(d, 1)) if (!estWeekEnd(d)) n++;
  return n;
}

/**
 * Place les tâches. Fenêtres de phases proportionnelles aux jours (minimum 1) ; marge de 8 % en fin
 * de mission pour absorber les jours fériés que le moteur ajoutera.
 */
export function placerTaches(
  phases: readonly PhaseACalendrier[],
  debut: string,
  fin: string,
): Map<string, PlacementTache> {
  const placement = new Map<string, PlacementTache>();
  const total = ecartJours(debut, fin) + 1;
  const utile = Math.max(7, Math.floor(total * 0.92));
  const poids = phases.map((p) =>
    Math.max(
      1,
      p.taches.reduce((s, t) => s + t.jours, 0),
    ),
  );
  const somme = poids.reduce((a, b) => a + b, 0);
  let cumul = 0;
  for (const [i, phase] of phases.entries()) {
    const largeur = Math.max(5, Math.round((utile * (poids[i] as number)) / somme));
    const debutPhase = jourOuvre(ajouterJours(debut, Math.min(cumul, utile - 5)));
    cumul += largeur;
    const finPhase = ajouterJours(debut, Math.min(cumul - 1, utile));
    const dispo = Math.max(2, joursOuvres(debutPhase, finPhase));
    const duree = Math.max(2, Math.floor(dispo * 0.5));
    const n = phase.taches.length;
    const pas = n > 1 ? Math.max(0, (dispo - duree) / (n - 1)) : 0;
    for (const [j, tache] of phase.taches.entries()) {
      placement.set(tache.id, {
        debut: ajouterOuvres(debutPhase, Math.round(j * pas)),
        duree,
      });
    }
  }
  return placement;
}
