import { describe, expect, it } from "vitest";
import { etatCompteur, longueurSaisie } from "./ZoneTexte.aide";

describe("etatCompteur", () => {
  it("sans limite : pas de restants ni d'alerte", () => {
    expect(etatCompteur(12)).toEqual({
      longueur: 12,
      restants: undefined,
      proche: false,
      atteint: false,
    });
    expect(etatCompteur(5, 0).restants).toBeUndefined();
  });

  it("avec limite : restants, proximité à 90 %, atteinte", () => {
    expect(etatCompteur(10, 100)).toMatchObject({ restants: 90, proche: false, atteint: false });
    expect(etatCompteur(90, 100)).toMatchObject({ restants: 10, proche: true, atteint: false });
    expect(etatCompteur(100, 100)).toMatchObject({ restants: 0, proche: true, atteint: true });
    expect(etatCompteur(120, 100)).toMatchObject({ restants: 0, atteint: true });
  });

  it("borne les longueurs négatives", () => {
    expect(etatCompteur(-3, 10).longueur).toBe(0);
  });
});

describe("longueurSaisie", () => {
  it("accepte chaîne, nombre, tableau et absence", () => {
    expect(longueurSaisie("abc")).toBe(3);
    expect(longueurSaisie(1234)).toBe(4);
    expect(longueurSaisie(["a", "b"])).toBe(3);
    expect(longueurSaisie(undefined)).toBe(0);
  });
});
