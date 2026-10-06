import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import { entier } from "./fraction";
import { TOLERANCE_TENDANCE_KPI_DEFAUT, regressionExacte, tendanceKpi } from "./tendance";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

describe("tendance", () => {
  it("tolérance par défaut de 2 %", () => {
    expect(TOLERANCE_TENDANCE_KPI_DEFAUT).toBe(0.02);
  });

  it("hausse : amélioration en « plus haut », dégradation en « plus bas »", () => {
    expect(tendanceKpi([100, 110, 120], "plus_haut_mieux")).toEqual({
      direction: "hausse",
      evolution: "amelioration",
      pente: 10,
      variation: 20,
      variationRelative: 0.1818,
      points: 3,
    });
    expect(tendanceKpi([100, 110, 120], "plus_bas_mieux").evolution).toBe("degradation");
  });

  it("baisse : amélioration en « plus bas »", () => {
    expect(tendanceKpi([120, 110, 100], "plus_bas_mieux")).toMatchObject({
      direction: "baisse",
      evolution: "amelioration",
      pente: -10,
    });
    expect(tendanceKpi([120, 110, 100], "plus_haut_mieux").evolution).toBe("degradation");
  });

  it("stable dans la tolérance, borne incluse", () => {
    expect(tendanceKpi([100, 101, 100.5], "plus_haut_mieux")).toMatchObject({
      direction: "stable",
      evolution: "stable",
      pente: 0.25,
      variation: 0.5,
    });
    // Variation 2 = 2 % de la moyenne 100 : encore stable ; un cheveu de plus : hausse.
    expect(tendanceKpi([99, 101], "plus_haut_mieux").direction).toBe("stable");
    expect(tendanceKpi([99, 101.0001], "plus_haut_mieux").direction).toBe("hausse");
    expect(
      tendanceKpi([100, 101, 100.5], "plus_haut_mieux", { toleranceRelative: 0 }).direction,
    ).toBe("hausse");
  });

  it("une période non mesurée garde sa place", () => {
    expect(tendanceKpi([100, null, 120], "plus_haut_mieux")).toMatchObject({
      pente: 10,
      variation: 20,
      points: 2,
    });
  });

  it("moins de deux mesures : indéterminée", () => {
    for (const serie of [[], [5], [null, 5, null]]) {
      expect(tendanceKpi(serie, "plus_haut_mieux")).toMatchObject({
        direction: "indeterminee",
        evolution: "indeterminee",
        pente: null,
        variation: null,
        variationRelative: null,
      });
    }
  });

  it("fenêtre sur les dernières périodes", () => {
    expect(tendanceKpi([500, 100, 110], "plus_haut_mieux", { fenetre: 2 })).toMatchObject({
      direction: "hausse",
      pente: 10,
    });
    expect(tendanceKpi([500, 100, 110], "plus_haut_mieux").direction).toBe("baisse");
    expect(codeErreur(() => tendanceKpi([1, 2], "plus_haut_mieux", { fenetre: 1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(codeErreur(() => tendanceKpi([1, 2], "plus_haut_mieux", { fenetre: 2.5 }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });

  it("moyenne nulle : variation relative absente, tolérance absolue", () => {
    expect(tendanceKpi([-1, 1], "plus_haut_mieux")).toMatchObject({
      direction: "hausse",
      variationRelative: null,
    });
    expect(tendanceKpi([-1, 1], "plus_haut_mieux", { toleranceAbsolue: 2 }).direction).toBe(
      "stable",
    );
  });

  it("refuse une tolérance négative ou une valeur non finie", () => {
    expect(
      codeErreur(() => tendanceKpi([1, 2], "plus_haut_mieux", { toleranceRelative: -0.1 })),
    ).toBe("OPTIONS_INVALIDES");
    expect(codeErreur(() => tendanceKpi([1, Infinity], "plus_haut_mieux"))).toBe("NOMBRE_INVALIDE");
  });

  it("régression : abscisses toutes égales, pas de droite", () => {
    expect(
      regressionExacte([
        { x: entier(3), y: entier(1) },
        { x: entier(3), y: entier(2) },
      ]),
    ).toBeNull();
  });
});
