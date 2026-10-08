/**
 * Classes de risque R0 à R3 (QUA-01, PRD complémentaire §10) : niveau
 * d'engagement d'une brique ou d'un livrable, qui fixe la garde humaine.
 *
 * - R0 : opérationnel interne (relance, rappel, classement) ;
 * - R1 : analyse interne (brouillons, notes de travail) ;
 * - R2 : livrable client ;
 * - R3 : engageant (chiffres financiers, notation publiée, recommandation
 *   d'investissement, plan de redressement).
 *
 * L'ordre compte : une règle de modulation peut RELEVER une classe, jamais
 * l'abaisser (`classeRisqueMax`).
 */
export const CLASSES_RISQUE = ["R0", "R1", "R2", "R3"] as const;

export type ClasseRisque = (typeof CLASSES_RISQUE)[number];

export function estClasseRisque(valeur: unknown): valeur is ClasseRisque {
  return typeof valeur === "string" && (CLASSES_RISQUE as readonly string[]).includes(valeur);
}

/** Rang de la classe (R0 → 0, R3 → 3). */
export function rangClasseRisque(classe: ClasseRisque): number {
  return CLASSES_RISQUE.indexOf(classe);
}

/** Classe la plus élevée de la liste ; `null` si la liste est vide. */
export function classeRisqueMax(classes: readonly ClasseRisque[]): ClasseRisque | null {
  let max: ClasseRisque | null = null;
  for (const classe of classes) {
    if (max === null || rangClasseRisque(classe) > rangClasseRisque(max)) max = classe;
  }
  return max;
}
