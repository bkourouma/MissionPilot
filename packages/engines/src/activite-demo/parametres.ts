/**
 * Paramètres de l'activité de démonstration automatique (job « activite_demo », DECISIONS
 * « Activité de démonstration automatique », 2026-11-01) et petits outils de calcul partagés par
 * les modules du moteur. Quantités en centièmes de jour entiers, pas de saisie de 50 (demi-journée,
 * seule granularité prise en charge : DT10). Valeurs de démonstration, à valider par le métier.
 */
import { type DateISO, jourSemaine } from "../planning/dates";

export const PARAMETRES_ACTIVITE_DEMO = {
  /** Pas de saisie en centièmes (demi-journée). */
  pasCentiemes: 50,
  /** Plafond d'une journée de feuille, en centièmes. */
  ligneMaxCentiemes: 100,
  /** Tâches de mission au plus par jour de feuille. */
  tachesMaxParJour: 2,
  /** Part de la capacité au plus consacrée aux missions (DT7). */
  tauxMissionPct: 80,
  /** Bande de dérive maintenue sur UNE mission (DT6), en pour mille de l'écart à terminaison. */
  derive: { ciblePourMille: 120, basPourMille: 80, hautPourMille: 160, seuilAffichePourMille: 50 },
  /** Âge des factures du job soldées en priorité, puis au plus tôt (DT8), en jours. */
  encaissement: { cibleJours: 21, minimumJours: 7 },
  /** Avenant mensuel de prolongation (DT1, DT11). */
  prolongation: {
    occupationEquipePct: 85,
    occupationEncadrementPct: 50,
    minimumMembreCentiemes: 100,
    maximumMissionCentiemes: 6000,
    avenantsMaxParMission: 36,
    avenantsMaxParMois: 10,
  },
  semainesMax: 6,
  collaborateursMax: 60,
  missionsMax: 50,
  sourcesFactureMax: 5,
} as const;
export type ParametresActiviteDemo = typeof PARAMETRES_ACTIVITE_DEMO;

/** Arrondi au pas inférieur d'une quantité positive en centièmes. */
export function plancherPas(centiemes: number, pas: number): number {
  return Math.floor(centiemes / pas) * pas;
}

/** Arrondi au pas supérieur d'une quantité positive en centièmes. */
export function plafondPas(centiemes: number, pas: number): number {
  return Math.ceil(centiemes / pas) * pas;
}

/** Lève une `RangeError` si la valeur n'est pas un nombre entier positif ou nul de centièmes. */
export function exigerCentiemes(valeur: number, quoi: string): void {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new RangeError(`${quoi} invalide : ${valeur} (centièmes entiers positifs attendus)`);
  }
}

/** Lève une `RangeError` si la date n'est pas un lundi (ou n'est pas une date valide). */
export function exigerLundiDemo(date: DateISO): void {
  if (jourSemaine(date) !== 1) throw new RangeError(`Lundi attendu : « ${date} »`);
}

/** Ordre total sur les identifiants et les dates ISO (indépendant de la locale). */
export const comparerTexteDemo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
