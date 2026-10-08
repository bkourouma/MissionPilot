import { ErreurCapitalisation } from "./erreurs";

/**
 * Agrégation ROBUSTE d'observations entières positives (centièmes de jour) : quartiles par
 * interpolation linéaire (méthode « type 7 », celle des tableurs), arrondis à l'entier, moitié
 * vers le haut ; valeurs atypiques selon les barrières de Tukey (1,5 × écart interquartile).
 * Arithmétique entière exacte : aucun flottant.
 */

export interface ResumeRobuste {
  effectif: number;
  min: number;
  q1: number;
  mediane: number;
  q3: number;
  max: number;
  /** Observations hors des barrières de Tukey, comptées mais conservées dans les quartiles. */
  atypiques: number;
}

/** Quartile k/4 (k = 1, 2, 3) d'une série triée non vide, arrondi à l'entier (moitié vers le haut). */
export function quartileEntier(tries: readonly number[], k: 1 | 2 | 3): number {
  const n = tries.length;
  const position4 = (n - 1) * k;
  const bas = Math.floor(position4 / 4);
  const fraction = position4 % 4;
  const x0 = tries[bas] as number;
  const x1 = tries[Math.min(bas + 1, n - 1)] as number;
  // Valeur × 4, exacte : 4·x0 + fraction·(x1 − x0) ; puis division par 4 arrondie.
  const fois4 = 4 * x0 + fraction * (x1 - x0);
  return Math.floor((fois4 + 2) / 4);
}

function exigerValeurs(valeurs: readonly number[]): void {
  for (const v of valeurs) {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new ErreurCapitalisation(
        "CENTIEMES_INVALIDES",
        "Une observation doit être un entier positif ou nul.",
      );
    }
  }
}

/** Résumé robuste d'une série (null si elle est vide). */
export function resumeRobuste(valeurs: readonly number[]): ResumeRobuste | null {
  exigerValeurs(valeurs);
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const q1 = quartileEntier(tries, 1);
  const q3 = quartileEntier(tries, 3);
  const iqr = q3 - q1;
  // Barrières × 2 pour rester entier : 2x < 2·q1 − 3·iqr ou 2x > 2·q3 + 3·iqr.
  const atypiques = tries.filter((x) => 2 * x < 2 * q1 - 3 * iqr || 2 * x > 2 * q3 + 3 * iqr);
  return {
    effectif: tries.length,
    min: tries[0] as number,
    q1,
    mediane: quartileEntier(tries, 2),
    q3,
    max: tries[tries.length - 1] as number,
    atypiques: atypiques.length,
  };
}
