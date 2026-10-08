import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import { BORNES_SCORE_KPI_DEFAUT, scoreCompositeKpi, type KpiPondere } from "./score";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

function kpi(code: string, poids: number, valeur: number | null, cible: number | null = 100) {
  return { code, poids, valeur, cible, sens: "plus_haut_mieux" } as const;
}

describe("score composite pondéré", () => {
  it("pondère, normalise sur les KPI retenus, exclut et signale les autres", () => {
    const resultat = scoreCompositeKpi([
      kpi("A", 2, 95),
      { code: "B", poids: 1, valeur: 120, cible: 100, sens: "plus_bas_mieux" },
      kpi("C", 1, null),
      kpi("D", 1, 10, null),
    ]);
    expect(resultat).toEqual({
      score: 0.9,
      scoreExact: "9/10",
      statut: "orange",
      contributions: [
        { code: "A", poidsNormalise: 0.6667, taux: 0.95, contribution: 0.6333, statut: "vert" },
        { code: "B", poidsNormalise: 0.3333, taux: 0.8, contribution: 0.2667, statut: "orange" },
      ],
      exclus: [
        { code: "C", raison: "non_mesure" },
        { code: "D", raison: "sans_cible" },
      ],
      couverture: 0.6,
    });
  });

  it("borne par défaut chaque taux à [0 ; 1] : pas de compensation", () => {
    expect(BORNES_SCORE_KPI_DEFAUT).toEqual({ plancher: 0, plafond: 1 });
    const kpis = [kpi("A", 1, 150), kpi("B", 1, 50)];
    expect(scoreCompositeKpi(kpis)).toMatchObject({ score: 0.75, statut: "rouge" });
    expect(scoreCompositeKpi(kpis, { plafond: null })).toMatchObject({ score: 1, statut: "vert" });
    expect(scoreCompositeKpi([kpi("A", 1, -50), kpi("B", 1, 100)]).score).toBe(0.5);
    expect(scoreCompositeKpi([kpi("A", 1, -50), kpi("B", 1, 100)], { plancher: null }).score).toBe(
      0.25,
    );
  });

  it("statut du score aux bornes exactes", () => {
    // (1 × 1 + 2 × 0,925) / 3 = 0,95 exactement.
    expect(scoreCompositeKpi([kpi("A", 1, 100), kpi("B", 2, 92.5)])).toMatchObject({
      score: 0.95,
      statut: "vert",
    });
    expect(scoreCompositeKpi([kpi("A", 1, 80), kpi("B", 1, 80)]).statut).toBe("orange");
    expect(scoreCompositeKpi([kpi("A", 1, 80), kpi("B", 1, 79.99)]).statut).toBe("rouge");
    expect(
      scoreCompositeKpi([kpi("A", 1, 90)], { seuils: { vert: 0.9, orange: 0.5 } }).statut,
    ).toBe("vert");
  });

  it("aucun KPI mesuré : score absent, non mesuré, couverture nulle", () => {
    expect(scoreCompositeKpi([kpi("A", 1, null), kpi("B", 3, 5, null)])).toEqual({
      score: null,
      scoreExact: null,
      statut: "non_mesure",
      contributions: [],
      exclus: [
        { code: "A", raison: "non_mesure" },
        { code: "B", raison: "sans_cible" },
      ],
      couverture: 0,
    });
  });

  it("KPI retenus de poids nul seulement : score absent", () => {
    const resultat = scoreCompositeKpi([kpi("A", 0, 100), kpi("B", 1, null)]);
    expect(resultat).toMatchObject({ score: null, statut: "non_mesure", couverture: 0 });
    expect(resultat.contributions).toEqual([
      { code: "A", poidsNormalise: 0, taux: 1, contribution: 0, statut: "vert" },
    ]);
  });

  it("indépendant de l'ordre des KPI", () => {
    const kpis: KpiPondere[] = [kpi("A", 3, 91.7), kpi("B", 1.5, 64.2), kpi("C", 0.25, 103)];
    const a = scoreCompositeKpi(kpis);
    const b = scoreCompositeKpi([...kpis].reverse());
    expect(b.scoreExact).toBe(a.scoreExact);
    expect(b.score).toBe(a.score);
  });

  it("refuse les doublons, un poids négatif, une somme de poids nulle", () => {
    expect(codeErreur(() => scoreCompositeKpi([kpi("A", 1, 1), kpi("A", 1, 2)]))).toBe(
      "KPI_EN_DOUBLE",
    );
    expect(codeErreur(() => scoreCompositeKpi([kpi("A", -1, 1)]))).toBe("PONDERATION_INVALIDE");
    expect(codeErreur(() => scoreCompositeKpi([kpi("A", 0, 1)]))).toBe("PONDERATION_INVALIDE");
    expect(codeErreur(() => scoreCompositeKpi([]))).toBe("PONDERATION_INVALIDE");
    expect(codeErreur(() => scoreCompositeKpi([kpi("A", Number.NaN, 1)]))).toBe("NOMBRE_INVALIDE");
    expect(codeErreur(() => scoreCompositeKpi([kpi("A", 1, 1)], { plafond: 0.5 }))).toBe(
      "BORNES_INVALIDES",
    );
  });
});
