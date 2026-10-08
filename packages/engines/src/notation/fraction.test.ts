import { describe, expect, it } from "vitest";
import {
  ajouter,
  arrondir,
  borner,
  comparer,
  depuisNombre,
  depuisTexte,
  diviser,
  fraction,
  multiplier,
  somme,
  soustraire,
  versTexte,
} from "./fraction";

describe("fractions exactes de la notation", () => {
  it("convertit l'écriture décimale exacte, y compris en notation scientifique", () => {
    expect(depuisNombre(0.1)).toEqual({ num: 1n, den: 10n });
    expect(depuisNombre(-2.5)).toEqual({ num: -5n, den: 2n });
    expect(depuisNombre(1e21)).toEqual({ num: 10n ** 21n, den: 1n });
    expect(depuisNombre(1.5e-7)).toEqual({ num: 3n, den: 20_000_000n });
    expect(depuisNombre(0)).toEqual({ num: 0n, den: 1n });
    expect(() => depuisNombre(Number.NaN, "poids")).toThrow(
      expect.objectContaining({ code: "NOMBRE_INVALIDE" }),
    );
  });

  it("réduit et normalise le signe", () => {
    expect(fraction(6n, -4n)).toEqual({ num: -3n, den: 2n });
    expect(fraction(0n, 7n)).toEqual({ num: 0n, den: 1n });
    expect(() => fraction(1n, 0n)).toThrow(expect.objectContaining({ code: "NOMBRE_INVALIDE" }));
  });

  it("calcule sans erreur de flottant : 0,1 + 0,2 = 0,3", () => {
    expect(ajouter(depuisNombre(0.1), depuisNombre(0.2))).toEqual(depuisNombre(0.3));
    expect(soustraire(depuisNombre(0.3), depuisNombre(0.1))).toEqual(depuisNombre(0.2));
    expect(multiplier(depuisNombre(1.1), depuisNombre(3))).toEqual(depuisNombre(3.3));
    expect(diviser(depuisNombre(1), depuisNombre(3))).toEqual({ num: 1n, den: 3n });
    expect(somme([])).toEqual({ num: 0n, den: 1n });
  });

  it("compare et borne", () => {
    const tiers = fraction(1n, 3n);
    expect(comparer(tiers, depuisNombre(0.3333))).toBe(1);
    expect(comparer(depuisNombre(0.3333), tiers)).toBe(-1);
    expect(comparer(tiers, fraction(2n, 6n))).toBe(0);
    expect(borner(depuisNombre(-1), depuisNombre(0), depuisNombre(100))).toEqual(depuisNombre(0));
    expect(borner(depuisNombre(101), depuisNombre(0), depuisNombre(100))).toEqual(
      depuisNombre(100),
    );
    expect(borner(tiers, depuisNombre(0), depuisNombre(100))).toBe(tiers);
  });

  it("arrondit à 1 décimale, demi s'éloignant de zéro", () => {
    expect(arrondir(depuisNombre(62.25))).toBe(62.3);
    expect(arrondir(depuisNombre(62.24999))).toBe(62.2);
    expect(arrondir(depuisNombre(79.95))).toBe(80);
    expect(arrondir(depuisNombre(-0.05))).toBe(-0.1);
    expect(arrondir(depuisNombre(-0.04))).toBe(0);
    expect(Object.is(arrondir(depuisNombre(-0.04)), 0)).toBe(true);
    expect(arrondir(fraction(200n, 3n))).toBe(66.7);
    expect(arrondir(fraction(1n, 3n), 4)).toBe(0.3333);
  });

  it("trace une fraction en texte et la relit", () => {
    expect(versTexte(fraction(385n, 6n))).toBe("385/6");
    expect(versTexte(depuisNombre(-4))).toBe("-4");
    expect(depuisTexte("385/6")).toEqual(fraction(385n, 6n));
    expect(depuisTexte("-4")).toEqual(depuisNombre(-4));
    expect(() => depuisTexte("1/0")).toThrow(expect.objectContaining({ code: "NOMBRE_INVALIDE" }));
    expect(() => depuisTexte("abc")).toThrow(expect.objectContaining({ code: "NOMBRE_INVALIDE" }));
  });
});
