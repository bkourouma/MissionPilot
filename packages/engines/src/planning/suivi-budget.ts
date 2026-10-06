/**
 * Suivi budgétaire en jours-homme (TPS-05 à TPS-08).
 *
 *   Atterrissage = Réalisé + Reste à faire      Écart = Atterrissage − Budget
 *   Consommation = Réalisé / Budget
 *
 * Calculs en centièmes de jour (entiers). Un budget nul ne provoque jamais de
 * division par zéro : les ratios valent alors `null`.
 */
import { depuisCentiemes, versCentiemes } from "./unites";

/** Valeurs saisies pour une tâche (ou agrégées pour un niveau supérieur). */
export interface LigneSuivi {
  readonly budget: number;
  readonly realise: number;
  readonly resteAFaire: number;
}

/** Ligne de suivi complétée des grandeurs calculées. */
export interface SuiviCalcule extends LigneSuivi {
  readonly atterrissage: number;
  readonly ecart: number;
  /** Écart / budget (0,05 = +5 %), `null` si budget nul. */
  readonly ecartRelatif: number | null;
  /** Réalisé / budget (0,8 = 80 %), `null` si budget nul. */
  readonly consommation: number | null;
}

/** Couleur de pilotage (TPS-06). */
export type StatutCouleur = "vert" | "orange" | "rouge";

/**
 * Seuils de couleur et d'alerte, en pourcentage du budget. Défauts (à valider
 * par le métier) :
 * - orange dès 80 % de consommation, ou atterrissage > 100 % du budget ;
 * - rouge si atterrissage > 105 % du budget.
 * Les comparaisons d'atterrissage sont strictes (> : 105 % pile reste orange),
 * celle de consommation est large (≥ : 80 % pile déclenche l'orange).
 */
export interface SeuilsSuivi {
  readonly consommationOrangePct: number;
  readonly atterrissageOrangePct: number;
  readonly atterrissageRougePct: number;
}

export const SEUILS_SUIVI_DEFAUT: SeuilsSuivi = {
  consommationOrangePct: 80,
  atterrissageOrangePct: 100,
  atterrissageRougePct: 105,
};

function verifierPositif(nom: string, valeur: number): void {
  if (!Number.isFinite(valeur) || valeur < 0) {
    throw new RangeError(`${nom} invalide : ${valeur} (attendu un nombre ≥ 0)`);
  }
}

/** Atterrissage, écart et consommation d'une ligne (TPS-05). */
export function calculerSuivi(ligne: LigneSuivi): SuiviCalcule {
  verifierPositif("Budget", ligne.budget);
  verifierPositif("Réalisé", ligne.realise);
  verifierPositif("Reste à faire", ligne.resteAFaire);
  const budget = versCentiemes(ligne.budget);
  const realise = versCentiemes(ligne.realise);
  const reste = versCentiemes(ligne.resteAFaire);
  const atterrissage = realise + reste;
  const ecart = atterrissage - budget;
  return {
    budget: depuisCentiemes(budget),
    realise: depuisCentiemes(realise),
    resteAFaire: depuisCentiemes(reste),
    atterrissage: depuisCentiemes(atterrissage),
    ecart: depuisCentiemes(ecart),
    ecartRelatif: budget === 0 ? null : ecart / budget,
    consommation: budget === 0 ? null : realise / budget,
  };
}

/** Somme de lignes au centième près (agrégation PLN-02). */
export function sommerLignes(lignes: readonly LigneSuivi[]): LigneSuivi {
  let budget = 0;
  let realise = 0;
  let reste = 0;
  for (const l of lignes) {
    budget += versCentiemes(l.budget);
    realise += versCentiemes(l.realise);
    reste += versCentiemes(l.resteAFaire);
  }
  return {
    budget: depuisCentiemes(budget),
    realise: depuisCentiemes(realise),
    resteAFaire: depuisCentiemes(reste),
  };
}

/** `valeur > budget × pct %`, en entiers. */
function depasse(valeurC: number, budgetC: number, pct: number): boolean {
  return valeurC * 100 > budgetC * pct;
}

/**
 * Couleur d'une ligne (TPS-06). Budget nul : vert si rien n'est consommé ni
 * prévu, rouge sinon (tout jour sur une tâche non budgétée est un dépassement).
 */
export function statutCouleur(
  ligne: LigneSuivi,
  seuils: SeuilsSuivi = SEUILS_SUIVI_DEFAUT,
): StatutCouleur {
  const s = calculerSuivi(ligne);
  const budget = versCentiemes(s.budget);
  const atterrissage = versCentiemes(s.atterrissage);
  const realise = versCentiemes(s.realise);
  if (budget === 0) return atterrissage > 0 ? "rouge" : "vert";
  if (depasse(atterrissage, budget, seuils.atterrissageRougePct)) return "rouge";
  if (depasse(atterrissage, budget, seuils.atterrissageOrangePct)) return "orange";
  const consommationAtteinte = realise * 100 >= budget * seuils.consommationOrangePct;
  return consommationAtteinte ? "orange" : "vert";
}

/** Type d'alerte au chef et au directeur de mission (TPS-07). */
export type TypeAlerte = "consommation_seuil" | "atterrissage_superieur_budget";

export interface AlerteSuivi {
  readonly type: TypeAlerte;
  readonly message: string;
}

/**
 * Alertes d'une ligne (TPS-07) : consommation ≥ seuil (défaut 80 %), ou
 * atterrissage strictement supérieur au budget. Budget nul : toute
 * consommation ou tout atterrissage positif déclenche l'alerte.
 */
export function detecterAlertes(ligne: LigneSuivi, seuilConsommationPct = 80): AlerteSuivi[] {
  const s = calculerSuivi(ligne);
  const budget = versCentiemes(s.budget);
  const realise = versCentiemes(s.realise);
  const alertes: AlerteSuivi[] = [];
  const consoAtteinte = budget === 0 ? realise > 0 : realise * 100 >= budget * seuilConsommationPct;
  if (consoAtteinte) {
    alertes.push({
      type: "consommation_seuil",
      message: `Consommation ≥ ${seuilConsommationPct} % du budget`,
    });
  }
  if (s.ecart > 0) {
    alertes.push({
      type: "atterrissage_superieur_budget",
      message: `Atterrissage supérieur au budget de ${s.ecart} j`,
    });
  }
  return alertes;
}

/** Élément d'avancement physique : livrable ou jalon, pondéré (TPS-08). */
export interface ElementAvancement {
  readonly atteint: boolean;
  /** Poids relatif (défaut 1). */
  readonly poids?: number;
}

/** Avancement physique pondéré dans [0 ; 1], `null` si aucun élément. */
export function avancementPhysique(elements: readonly ElementAvancement[]): number | null {
  let total = 0;
  let atteint = 0;
  for (const e of elements) {
    const poids = e.poids ?? 1;
    verifierPositif("Poids", poids);
    total += poids;
    if (e.atteint) atteint += poids;
  }
  return total === 0 ? null : atteint / total;
}

/** Indicateur de performance de la mission (TPS-08). */
export interface PerformanceMission {
  readonly avancement: number;
  readonly consommation: number | null;
  /**
   * Avancement / consommation : > 1 la mission produit plus qu'elle ne
   * consomme, < 1 elle consomme plus qu'elle n'avance. `null` si budget ou
   * réalisé nul.
   */
  readonly indice: number | null;
  /** Avancement − consommation, en points de fraction (0,1 = 10 points). */
  readonly ecartPoints: number | null;
}

/** Compare l'avancement physique (0..1) au consommé (réalisé / budget). */
export function performanceMission(
  avancement: number,
  ligne: Pick<LigneSuivi, "budget" | "realise">,
): PerformanceMission {
  if (!Number.isFinite(avancement) || avancement < 0 || avancement > 1) {
    throw new RangeError(`Avancement invalide : ${avancement} (attendu entre 0 et 1)`);
  }
  const { consommation } = calculerSuivi({ ...ligne, resteAFaire: 0 });
  return {
    avancement,
    consommation,
    indice: consommation === null || consommation === 0 ? null : avancement / consommation,
    ecartPoints: consommation === null ? null : avancement - consommation,
  };
}
