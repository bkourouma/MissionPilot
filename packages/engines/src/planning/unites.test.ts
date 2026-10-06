import { describe, expect, it } from "vitest";
import {
  arrondiEntier,
  arrondirAuPas,
  arrondirJours,
  depuisCentiemes,
  estPasValide,
  heuresVersJours,
  joursVersHeures,
  joursVersMinutes,
  sommerHeuresEnJours,
  sommerJours,
  verifierHeuresParJour,
  versCentiemes,
} from "./unites";

describe("arrondis entiers", () => {
  it("arrondit sans bruit flottant et de façon symétrique", () => {
    expect(arrondiEntier(1.005 * 100)).toBe(101);
    expect(arrondiEntier(2.5)).toBe(3);
    expect(arrondiEntier(-2.5)).toBe(-3);
    expect(Object.is(arrondiEntier(-0.2), 0)).toBe(true);
    expect(() => arrondiEntier(Number.NaN)).toThrow(RangeError);
    expect(() => arrondiEntier(Infinity)).toThrow(RangeError);
  });

  it("convertit en centièmes et somme exactement", () => {
    expect(versCentiemes(0.1 + 0.2)).toBe(30);
    expect(depuisCentiemes(250)).toBe(2.5);
    expect(arrondirJours(1.234)).toBe(1.23);
    expect(sommerJours([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sommerJours([])).toBe(0);
  });
});

describe("conversion heures ↔ jours", () => {
  it("utilise la durée de journée paramétrable", () => {
    expect(heuresVersJours(4)).toBe(0.5);
    expect(heuresVersJours(8)).toBe(1);
    expect(heuresVersJours(3.75, 7.5)).toBe(0.5);
    expect(heuresVersJours(1, 8)).toBe(0.13); // 0,125 arrondi au centième
    expect(joursVersHeures(0.5)).toBe(4);
    expect(joursVersHeures(1, 7.5)).toBe(7.5);
    expect(joursVersMinutes(1.5, 8)).toBe(720);
  });

  it("somme des heures avant conversion pour éviter le cumul d'arrondis", () => {
    const quartsDHeure = Array.from({ length: 32 }, () => 0.25);
    expect(sommerHeuresEnJours(quartsDHeure)).toBe(1);
    expect(sommerJours(quartsDHeure.map((h) => heuresVersJours(h)))).not.toBe(1);
  });

  it("refuse une durée de journée invalide", () => {
    expect(() => verifierHeuresParJour(0)).toThrow(RangeError);
    expect(() => verifierHeuresParJour(25)).toThrow(RangeError);
    expect(() => verifierHeuresParJour(Number.NaN)).toThrow(RangeError);
    expect(() => heuresVersJours(1, -8)).toThrow(RangeError);
    expect(() => joursVersMinutes(1, 0)).toThrow(RangeError);
  });
});

describe("pas de saisie", () => {
  it("arrondit à la demi-journée", () => {
    expect(arrondirAuPas(0.24, "demi_journee")).toBe(0);
    expect(arrondirAuPas(0.25, "demi_journee")).toBe(0.5);
    expect(arrondirAuPas(0.74, "demi_journee")).toBe(0.5);
    expect(arrondirAuPas(1.8, "demi_journee")).toBe(2);
  });

  it("arrondit à la minute en mode heure", () => {
    // 0,3 j × 8 h = 2 h 24 → 0,3 j
    expect(arrondirAuPas(0.3, "heure")).toBe(0.3);
    expect(arrondirAuPas(0.123456, "heure", 8)).toBe(0.12);
  });

  it("valide un pas de saisie", () => {
    expect(estPasValide(0.5, "demi_journee")).toBe(true);
    expect(estPasValide(0, "demi_journee")).toBe(true);
    expect(estPasValide(0.3, "demi_journee")).toBe(false);
    expect(estPasValide(0.505, "demi_journee")).toBe(false);
    expect(estPasValide(-0.5, "demi_journee")).toBe(false);
    expect(estPasValide(Number.NaN, "heure")).toBe(false);
    expect(estPasValide(0.125, "heure", 8)).toBe(true); // 60 minutes
    expect(estPasValide(0.0001, "heure", 8)).toBe(false);
    expect(() => estPasValide(0.5, "heure", 0)).toThrow(RangeError);
  });
});
