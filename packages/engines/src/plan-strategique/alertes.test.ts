import { describe, expect, it } from "vitest";
import { detecterAlertesPlan, type ExerciceSurveille } from "./index";

function exercice(
  annee: number,
  tresorerieNette: number,
  capitauxPropres: number,
  capital = 1_000,
  ecart = 0,
): ExerciceSurveille {
  return {
    annee,
    exercice: 2026 + annee,
    bilan: { tresorerieNette, capitauxPropres, capital },
    controle: { ecart, equilibre: ecart === 0 },
  };
}

describe("detecterAlertesPlan", () => {
  it("aucune alerte pour une situation saine", () => {
    expect(detecterAlertesPlan([exercice(1, 0, 500), exercice(2, 10, 2_000)])).toEqual([]);
  });

  it("seuil de la moitié du capital : strictement inférieur", () => {
    expect(detecterAlertesPlan([exercice(1, 0, 500)])).toEqual([]);
    expect(detecterAlertesPlan([exercice(1, 0, 499)])).toEqual([
      {
        code: "CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL",
        gravite: "attention",
        annee: 1,
        exercice: 2027,
        montant: 499,
        seuil: 500,
      },
    ]);
    // Capital impair : la moitié de 1 001 est 500,5 ; 500 est en dessous.
    expect(detecterAlertesPlan([exercice(1, 0, 500, 1_001)])[0]?.seuil).toBe(501);
  });

  it("capitaux propres négatifs : une seule alerte critique (pas de doublon « moitié »)", () => {
    expect(detecterAlertesPlan([exercice(1, 0, -1)]).map((a) => a.code)).toEqual([
      "CAPITAUX_PROPRES_NEGATIFS",
    ]);
  });

  it("signale un bilan déséquilibré et trie par année", () => {
    const alertes = detecterAlertesPlan([exercice(1, -5, 2_000), exercice(2, 0, 2_000, 1_000, 3)]);
    expect(alertes.map((a) => [a.annee, a.code, a.montant, a.gravite])).toEqual([
      [1, "TRESORERIE_NEGATIVE", -5, "critique"],
      [2, "BILAN_DESEQUILIBRE", 3, "critique"],
    ]);
  });
});
