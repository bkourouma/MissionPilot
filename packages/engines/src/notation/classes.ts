/**
 * Barème des classes de notation (NOT-03, DECISIONS.md « Règles métier
 * validées ») : score 0–100, A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, E < 35.
 *
 * La classe se lit sur le score AFFICHÉ (arrondi à 1 décimale) : un score
 * exact de 79,96 s'affiche 80,0 et vaut A, pour que score et classe restent
 * cohérents à l'écran comme dans le rapport.
 */
import { ErreurNotation } from "./erreurs";

export type Classe = "A" | "B" | "C" | "D" | "E";

export const BAREME_CLASSES: readonly { readonly classe: Classe; readonly min: number }[] = [
  { classe: "A", min: 80 },
  { classe: "B", min: 65 },
  { classe: "C", min: 50 },
  { classe: "D", min: 35 },
  { classe: "E", min: 0 },
];

/** Rang d'une classe : E = 1 … A = 5 (comparaison avant/après). */
export function rangClasse(c: Classe): number {
  return BAREME_CLASSES.length - BAREME_CLASSES.findIndex((b) => b.classe === c);
}

/** Classe d'un score compris entre 0 et 100. */
export function classe(score: number): Classe {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new ErreurNotation("SCORE_INVALIDE", `Score hors de l'échelle 0–100 : ${score}.`);
  }
  return (BAREME_CLASSES.find((b) => score >= b.min) as { classe: Classe }).classe;
}
