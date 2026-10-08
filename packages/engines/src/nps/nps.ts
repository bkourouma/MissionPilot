/**
 * Synthèse de satisfaction « NPS » (QUA-08, PRD complémentaire §10) :
 * promoteurs (9–10), passifs (7–8), détracteurs (0–6) ;
 * NPS = (promoteurs − détracteurs) / total × 100, arrondi au dixième, au plus
 * loin de zéro en cas d'égalité (moitié vers le haut en valeur absolue).
 *
 * Arithmétique ENTIÈRE exacte (BigInt) : aucun flottant. Fonction pure et
 * déterministe ; l'API (`apps/api/src/qualite/satisfaction.ts`) l'appelle,
 * elle ne recalcule rien.
 */

export type CodeErreurNps = "NOTE_INVALIDE";

export class ErreurNps extends Error {
  readonly code: CodeErreurNps;

  constructor(code: CodeErreurNps, message: string) {
    super(message);
    this.name = "ErreurNps";
    this.code = code;
  }
}

export interface SyntheseNps {
  total: number;
  promoteurs: number;
  passifs: number;
  detracteurs: number;
  /** « 33.3 », « -50.0 » ; null sans réponse. */
  nps: string | null;
}

/** Note de satisfaction admise : entier de 0 à 10. */
export function estNoteSatisfaction(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 10;
}

export function syntheseNps(notes: readonly number[]): SyntheseNps {
  let promoteurs = 0;
  let passifs = 0;
  let detracteurs = 0;
  for (const n of notes) {
    if (!estNoteSatisfaction(n)) {
      throw new ErreurNps("NOTE_INVALIDE", "Note de satisfaction : entier de 0 à 10.");
    }
    if (n >= 9) promoteurs += 1;
    else if (n >= 7) passifs += 1;
    else detracteurs += 1;
  }
  const total = notes.length;
  if (total === 0) return { total, promoteurs, passifs, detracteurs, nps: null };
  const ecart = BigInt(promoteurs - detracteurs);
  const negatif = ecart < 0n;
  const absolu = negatif ? -ecart : ecart;
  const t = BigInt(total);
  // dixièmes de point = absolu × 1000 / total, arrondi à l'entier le plus proche (moitié vers le haut)
  const dixiemes = (absolu * 2000n + t) / (2n * t);
  const entier = dixiemes / 10n;
  const decimale = dixiemes % 10n;
  const signe = negatif && dixiemes !== 0n ? "-" : "";
  return { total, promoteurs, passifs, detracteurs, nps: `${signe}${entier}.${decimale}` };
}
