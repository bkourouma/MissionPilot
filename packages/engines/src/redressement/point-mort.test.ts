import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import { calculerPointMort } from "./point-mort";

const M = 1_000_000;
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("(T8) point mort", () => {
  it("bénéficiaire : seuil arrondi par excès, marge de sécurité, jours", () => {
    expect(
      calculerPointMort({
        chiffreAffaires: 1200 * M,
        chargesVariables: 780 * M,
        chargesFixes: 300 * M,
      }),
    ).toEqual({
      statut: "beneficiaire",
      periodeJours: 360,
      margeCoutVariable: 420 * M,
      tauxMargeCoutVariablePb: 3500,
      resultatExploitation: 120 * M,
      seuilRentabilite: 857_142_858,
      margeSecurite: 342_857_142,
      margeSecuritePb: 2857,
      pointMortJours: 257,
    });
  });

  it("déficitaire : marge de sécurité négative", () => {
    expect(
      calculerPointMort({
        chiffreAffaires: 1200 * M,
        chargesVariables: 780 * M,
        chargesFixes: 500 * M,
      }),
    ).toMatchObject({
      statut: "deficitaire",
      resultatExploitation: -80 * M,
      seuilRentabilite: 1_428_571_429,
      margeSecurite: -228_571_429,
      margeSecuritePb: -1905,
      pointMortJours: 429,
    });
  });

  it("à l'équilibre : seuil = chiffre d'affaires, 360 jours", () => {
    expect(
      calculerPointMort({
        chiffreAffaires: 1200 * M,
        chargesVariables: 780 * M,
        chargesFixes: 420 * M,
      }),
    ).toMatchObject({
      statut: "equilibre",
      resultatExploitation: 0,
      seuilRentabilite: 1200 * M,
      margeSecurite: 0,
      margeSecuritePb: 0,
      pointMortJours: 360,
    });
  });

  it("impossible : aucune marge sur coûts variables", () => {
    expect(
      calculerPointMort({ chiffreAffaires: 1000, chargesVariables: 1000, chargesFixes: 10 }),
    ).toEqual({
      statut: "impossible",
      periodeJours: 360,
      margeCoutVariable: 0,
      tauxMargeCoutVariablePb: 0,
      resultatExploitation: -10,
      seuilRentabilite: null,
      margeSecurite: null,
      margeSecuritePb: null,
      pointMortJours: null,
    });
    const negatif = calculerPointMort({
      chiffreAffaires: 1000,
      chargesVariables: 1500,
      chargesFixes: 0,
    });
    expect(negatif).toMatchObject({
      statut: "impossible",
      margeCoutVariable: -500,
      tauxMargeCoutVariablePb: -5000,
    });
  });

  it("chiffre d'affaires nul : non calculable, marge et résultat calculés", () => {
    expect(
      calculerPointMort({ chiffreAffaires: 0, chargesVariables: 0, chargesFixes: 100 }),
    ).toEqual({
      statut: "non_calculable",
      periodeJours: 360,
      margeCoutVariable: 0,
      tauxMargeCoutVariablePb: null,
      resultatExploitation: -100,
      seuilRentabilite: null,
      margeSecurite: null,
      margeSecuritePb: null,
      pointMortJours: null,
    });
  });

  it("période de 366 jours : jours recalculés", () => {
    const r = calculerPointMort({
      chiffreAffaires: 1200 * M,
      chargesVariables: 780 * M,
      chargesFixes: 420 * M,
      periodeJours: 366,
    });
    expect(r.periodeJours).toBe(366);
    expect(r.pointMortJours).toBe(366);
  });

  it("sans charges fixes : seuil nul", () => {
    expect(
      calculerPointMort({ chiffreAffaires: 100, chargesVariables: 40, chargesFixes: 0 }),
    ).toMatchObject({
      statut: "beneficiaire",
      seuilRentabilite: 0,
      margeSecurite: 100,
      pointMortJours: 0,
    });
  });

  it("entrées invalides : ENTREE_INVALIDE", () => {
    const base = { chiffreAffaires: 100, chargesVariables: 50, chargesFixes: 10 };
    expect(code(() => calculerPointMort({ ...base, periodeJours: 0 }))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerPointMort({ ...base, periodeJours: 367 }))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerPointMort({ ...base, periodeJours: 1.5 }))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerPointMort({ ...base, chiffreAffaires: -1 }))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerPointMort({ ...base, chargesVariables: -1 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => calculerPointMort({ ...base, chargesFixes: -1 }))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerPointMort({ ...base, chargesFixes: 0.5 }))).toBe("ENTREE_INVALIDE");
  });

  it("résultat hors des limites : SOMME_HORS_LIMITES", () => {
    expect(
      code(() =>
        calculerPointMort({
          chiffreAffaires: Number.MAX_SAFE_INTEGER,
          chargesVariables: 0,
          chargesFixes: Number.MAX_SAFE_INTEGER,
          periodeJours: 1,
        }),
      ),
    ).toBe("AUCUNE");
    expect(
      code(() =>
        calculerPointMort({
          chiffreAffaires: Number.MAX_SAFE_INTEGER,
          chargesVariables: 0,
          chargesFixes: 0,
        }),
      ),
    ).toBe("AUCUNE");
    // Taux en pb d'une marge énorme sur un petit chiffre d'affaires : jamais, car marge ≤ CA.
    // Seuil : fixes × CA / marge, avec marge = 1 et CA, fixes très grands.
    expect(
      code(() =>
        calculerPointMort({
          chiffreAffaires: Number.MAX_SAFE_INTEGER,
          chargesVariables: Number.MAX_SAFE_INTEGER - 1,
          chargesFixes: Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toBe("SOMME_HORS_LIMITES");
  });
});
