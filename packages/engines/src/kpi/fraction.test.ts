import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import { arrondir, depuisNombre, fraction, versTexte } from "./fraction";

describe("fractions exactes du pilotage KPI", () => {
  it("convertit l'écriture décimale, y compris scientifique", () => {
    expect(depuisNombre(0.95)).toEqual({ num: 19n, den: 20n });
    expect(depuisNombre(-2.5)).toEqual({ num: -5n, den: 2n });
    expect(depuisNombre(1e21)).toEqual({ num: 10n ** 21n, den: 1n });
    expect(depuisNombre(1.5e-7)).toEqual({ num: 3n, den: 20_000_000n });
  });

  it("refuse un nombre non fini et la division par zéro", () => {
    expect(() => depuisNombre(Number.NaN)).toThrow(ErreurKpi);
    expect(() => depuisNombre("3" as unknown as number)).toThrow(ErreurKpi);
    expect(() => fraction(1n, 0n)).toThrow(ErreurKpi);
  });

  it("réduit et normalise le signe", () => {
    expect(fraction(6n, -4n)).toEqual({ num: -3n, den: 2n });
    expect(versTexte(fraction(6n, -4n))).toBe("-3/2");
    expect(versTexte(fraction(8n, 4n))).toBe("2");
  });

  it("arrondit à 4 décimales, demi s'éloignant de zéro, sans zéro négatif", () => {
    expect(arrondir(fraction(1n, 20_000n))).toBe(0.0001);
    expect(arrondir(fraction(-1n, 20_000n))).toBe(-0.0001);
    expect(arrondir(fraction(1n, 3n))).toBe(0.3333);
    expect(arrondir(fraction(-2n, 3n))).toBe(-0.6667);
    expect(Object.is(arrondir(fraction(-1n, 1_000_000n)), 0)).toBe(true);
    expect(arrondir(fraction(5n, 2n), 0)).toBe(3);
  });
});
