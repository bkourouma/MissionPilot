import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import {
  ANALYSES_DD,
  CATEGORIES_ANALYSE_DD,
  estCategorieAnalyseDd,
  formaterPointsDeBase,
  NIVEAUX_ES,
  NIVEAUX_RISQUE_DD,
  rangNiveauEs,
  rangNiveauRisqueDd,
  THEMES_ES,
} from "./vocabulaire";

describe("vocabulaire", () => {
  it("catégories par analyse (18)", () => {
    expect(ANALYSES_DD).toEqual(["pestel", "cinq_forces", "swot", "operationnelle"]);
    expect(ANALYSES_DD.flatMap((a) => CATEGORIES_ANALYSE_DD[a])).toHaveLength(18);
    expect(estCategorieAnalyseDd("pestel", "politique")).toBe(true);
    expect(estCategorieAnalyseDd("swot", "politique")).toBe(false);
    expect(estCategorieAnalyseDd("inconnue" as never, "politique")).toBe(false);
  });

  it("huit thèmes E&S", () => {
    expect(THEMES_ES).toHaveLength(8);
  });

  it("rangs des niveaux", () => {
    expect(NIVEAUX_RISQUE_DD.map(rangNiveauRisqueDd)).toEqual([1, 2, 3, 4]);
    expect(NIVEAUX_ES.map(rangNiveauEs)).toEqual([0, 1, 2, 3, 4]);
    expect(() => rangNiveauRisqueDd("x" as never)).toThrow(ErreurDueDiligence);
    expect(() => rangNiveauEs("x" as never)).toThrow(ErreurDueDiligence);
  });

  it("formaterPointsDeBase", () => {
    expect(formaterPointsDeBase(4_000)).toBe("40 %");
    expect(formaterPointsDeBase(2_550)).toBe("25,5 %");
    expect(formaterPointsDeBase(3_333)).toBe("33,33 %");
    expect(formaterPointsDeBase(5)).toBe("0,05 %");
    expect(formaterPointsDeBase(10_000)).toBe("100 %");
    expect(formaterPointsDeBase(0)).toBe("0 %");
    expect(formaterPointsDeBase(10)).toBe("0,1 %");
    // Au-delà de 999 %, l'espace fine insécable sépare les milliers (comme `formaterMontant`).
    expect(formaterPointsDeBase(100_000)).toBe("1 000 %");
  });

  it("formaterPointsDeBase refuse les valeurs hors domaine", () => {
    for (const mauvais of [-1, 100_001, 1.5, Number.NaN]) {
      expect(() => formaterPointsDeBase(mauvais)).toThrow(ErreurDueDiligence);
    }
  });
});
