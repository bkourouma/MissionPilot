import { describe, expect, it } from "vitest";
import { ErreurPlan } from "./erreurs";
import { tauxRendementInterne, valeurActuelleNette } from "./index";

describe("valeurActuelleNette", () => {
  it("actualise dès la période 0 ou 1", () => {
    // −1 000 + 600 / 1,1 + 600 / 1,21 = 41,32 → 41.
    expect(valeurActuelleNette([-1_000, 600, 600], 10, 0)).toBe(41);
    // Dès la période 1 : 41,32 / 1,1 = 37,57 → 38.
    expect(valeurActuelleNette([-1_000, 600, 600], 10)).toBe(38);
  });

  it("à taux nul, somme des flux ; à taux négatif, valeur supérieure", () => {
    expect(valeurActuelleNette([100, 200, 300], 0)).toBe(600);
    // 100 / 0,5 = 200.
    expect(valeurActuelleNette([100], -50)).toBe(200);
    expect(valeurActuelleNette([], 12)).toBe(0);
  });

  it("refuse un taux ≤ −100 % ou un flux non entier", () => {
    expect(() => valeurActuelleNette([1], -100)).toThrow(ErreurPlan);
    expect(() => valeurActuelleNette([1], Number.NaN)).toThrow(ErreurPlan);
    let erreur: unknown = null;
    try {
      valeurActuelleNette([1, 2.5], 10);
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(ErreurPlan);
    expect((erreur as ErreurPlan).code).toBe("FLUX_INVALIDES");
    expect((erreur as ErreurPlan).chemin).toBe("flux[1]");
  });
});

describe("tauxRendementInterne", () => {
  it("cas exacts", () => {
    expect(tauxRendementInterne([-1_000, 1_100])).toBe(0.1);
    expect(tauxRendementInterne([-1_000, 1_000])).toBe(0);
    expect(tauxRendementInterne([-1_000, 500])).toBe(-0.5);
    // 1 000 x² − 600 x − 600 = 0 → x = 1,13066…
    expect(tauxRendementInterne([-1_000, 600, 600])).toBe(0.1307);
  });

  it("annule la VAN au taux trouvé (à l'arrondi près)", () => {
    const flux = [-5_000_000, 1_200_000, 1_500_000, 1_800_000, 2_000_000];
    const tri = tauxRendementInterne(flux) as number;
    expect(tri).toBeGreaterThan(0.1);
    expect(Math.abs(valeurActuelleNette(flux, tri * 100))).toBeLessThan(500);
  });

  it("ignore les zéros de tête et de queue, accepte un placement (flux positif d'abord)", () => {
    expect(tauxRendementInterne([0, -1_000, 1_100, 0, 0])).toBe(0.1);
    expect(tauxRendementInterne([1_000, -1_100])).toBe(0.1);
  });

  it("taux très élevé : recherche par doublement", () => {
    expect(tauxRendementInterne([-1, 1_000])).toBe(999);
  });

  it("non défini sans changement de signe ou avec plusieurs", () => {
    expect(tauxRendementInterne([100, 200])).toBeNull();
    expect(tauxRendementInterne([-100, -200])).toBeNull();
    expect(tauxRendementInterne([0, 0])).toBeNull();
    expect(tauxRendementInterne([])).toBeNull();
    expect(tauxRendementInterne([-100, 230, -132])).toBeNull();
  });

  it("refuse un flux non entier", () => {
    expect(() => tauxRendementInterne([-1, Number.POSITIVE_INFINITY])).toThrow(ErreurPlan);
  });
});
