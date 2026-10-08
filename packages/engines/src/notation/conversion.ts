/**
 * Conversion d'une réponse en points sur 100 (NOT-03), en fraction exacte.
 * Une réponse vide rend `null` (indicateur manquant) ; une réponse d'un type
 * étranger à la règle lève `REPONSE_INCOMPATIBLE` (les réponses doivent avoir
 * été validées contre le questionnaire, voir `preparerReponses`).
 */
import { estVide, type ValeurReponse } from "../questionnaires/types";
import { ErreurNotation } from "./erreurs";
import {
  CENT,
  ZERO,
  ajouter,
  arrondir,
  borner,
  comparer,
  depuisNombre,
  diviser,
  fraction,
  multiplier,
  soustraire,
  type Fraction,
} from "./fraction";
import type { PointsOption, RegleConversion } from "./grille";

function incompatible(regle: RegleConversion, valeur: unknown): never {
  throw new ErreurNotation(
    "REPONSE_INCOMPATIBLE",
    `Réponse ${JSON.stringify(valeur)} incompatible avec la règle « ${regle.type} ».`,
  );
}

function pointsCode(
  regle: RegleConversion,
  valeurs: readonly PointsOption[],
  code: unknown,
): Fraction {
  const v = valeurs.find((x) => x.code === code);
  if (v === undefined) incompatible(regle, code);
  return depuisNombre(v.points);
}

function nombre(regle: RegleConversion, valeur: unknown): Fraction {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) incompatible(regle, valeur);
  return depuisNombre(valeur);
}

/** Points exacts (0-100) d'une réponse selon la règle, ou `null` si la réponse est vide. */
export function pointsExacts(
  regle: RegleConversion,
  valeur: ValeurReponse | null | undefined,
): Fraction | null {
  if (estVide(valeur)) return null;
  switch (regle.type) {
    case "likert": {
      if (
        typeof valeur !== "number" ||
        !Number.isInteger(valeur) ||
        valeur < 1 ||
        valeur > regle.points
      ) {
        incompatible(regle, valeur);
      }
      const rang = regle.inverse === true ? regle.points - valeur : valeur - 1;
      return fraction(BigInt(rang) * 100n, BigInt(regle.points - 1));
    }
    case "choix":
      return pointsCode(regle, regle.valeurs, valeur);
    case "choix_multiple": {
      if (!Array.isArray(valeur)) incompatible(regle, valeur);
      const codes = [...new Set(valeur as readonly unknown[])];
      return borner(
        codes.reduce<Fraction>((s, c) => ajouter(s, pointsCode(regle, regle.valeurs, c)), ZERO),
        ZERO,
        CENT,
      );
    }
    case "oui_non":
      if (typeof valeur !== "boolean") incompatible(regle, valeur);
      return depuisNombre(valeur ? regle.oui : regle.non);
    case "seuils": {
      const x = nombre(regle, valeur);
      const atteint = regle.paliers.filter((p) => comparer(depuisNombre(p.min), x) <= 0);
      const palier = atteint[atteint.length - 1] ?? regle.paliers[0];
      return depuisNombre((palier as { points: number }).points);
    }
    case "interpolation": {
      const x = nombre(regle, valeur);
      const pts = regle.points.map((p) => ({ x: depuisNombre(p.x), y: depuisNombre(p.y) }));
      const premier = pts[0] as { x: Fraction; y: Fraction };
      const dernier = pts[pts.length - 1] as { x: Fraction; y: Fraction };
      if (comparer(x, premier.x) <= 0) return premier.y;
      if (comparer(x, dernier.x) >= 0) return dernier.y;
      const i = pts.findIndex((p) => comparer(p.x, x) >= 0);
      const b = pts[i] as { x: Fraction; y: Fraction };
      const a = pts[i - 1] as { x: Fraction; y: Fraction };
      // y = ya + (x − xa) × (yb − ya) / (xb − xa)
      return ajouter(
        a.y,
        multiplier(soustraire(x, a.x), diviser(soustraire(b.y, a.y), soustraire(b.x, a.x))),
      );
    }
  }
}

/** Points (0-100) d'une réponse, arrondis à 1 décimale ; `null` si la réponse est vide. */
export function scoreQuestion(
  regle: RegleConversion,
  valeur: ValeurReponse | null | undefined,
): number | null {
  const p = pointsExacts(regle, valeur);
  return p === null ? null : arrondir(p);
}
