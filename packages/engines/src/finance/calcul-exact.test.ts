import { describe, expect, it } from "vitest";
import {
  arrondirRationnel,
  comparerRationnels,
  differenceExacte,
  diviserArrondi,
  ratio,
  sommeExacte,
  soustraireRationnels,
  versEntierSur,
  versNombre,
  versRationnel,
} from "./calcul-exact";
import { ErreurFinance } from "./erreurs";

describe("versRationnel", () => {
  it("convertit l'écriture décimale la plus courte en fraction exacte", () => {
    expect(versRationnel(0.18)).toEqual({ num: 18n, den: 100n });
    expect(versRationnel(-2.5)).toEqual({ num: -25n, den: 10n });
    expect(versRationnel(655.957)).toEqual({ num: 655957n, den: 1000n });
    expect(versRationnel(42)).toEqual({ num: 42n, den: 1n });
  });

  it("gère la notation exponentielle", () => {
    expect(versRationnel(1e-7)).toEqual({ num: 1n, den: 10_000_000n });
    expect(versRationnel(1e21)).toEqual({ num: 10n ** 21n, den: 1n });
    expect(versRationnel(-1.5e-7)).toEqual({ num: -15n, den: 100_000_000n });
  });

  it("refuse NaN et l'infini", () => {
    expect(() => versRationnel(Number.NaN)).toThrow(ErreurFinance);
    expect(() => versRationnel(Infinity, "taux")).toThrow(/taux/);
  });
});

describe("diviserArrondi : au plus proche, demi s'éloignant de zéro", () => {
  it.each([
    [5n, 2n, 3n], // 2,5 → 3
    [-5n, 2n, -3n], // −2,5 → −3 (symétrique)
    [5n, -2n, -3n],
    [-5n, -2n, 3n],
    [7n, 2n, 4n], // 3,5 → 4
    [4n, 3n, 1n], // 1,33 → 1
    [5n, 3n, 2n], // 1,67 → 2
    [-4n, 3n, -1n],
    [6n, 3n, 2n],
  ])("%d / %d = %d", (num, den, attendu) => {
    expect(diviserArrondi(num, den)).toBe(attendu);
  });

  it("refuse la division par zéro", () => {
    expect(() => diviserArrondi(1n, 0n)).toThrow(/zéro/);
  });

  it("arrondit une fraction", () => {
    expect(arrondirRationnel({ num: 33333n, den: 2n })).toBe(16667n);
  });
});

describe("outils exacts", () => {
  it("compare des fractions", () => {
    expect(comparerRationnels({ num: 1n, den: 3n }, { num: 2n, den: 6n })).toBe(0);
    expect(comparerRationnels({ num: 1n, den: 3n }, { num: 1n, den: 2n })).toBe(-1);
    expect(comparerRationnels({ num: 3n, den: 4n }, { num: 1n, den: 2n })).toBe(1);
  });

  it("soustrait et convertit en nombre", () => {
    expect(versNombre(soustraireRationnels({ num: 3n, den: 10n }, { num: 1n, den: 10n }))).toBe(
      0.2,
    );
  });

  it("additionne des jours sans erreur de flottant", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sommeExacte([0.1, 0.2])).toBe(0.3);
    expect(sommeExacte([])).toBe(0);
    expect(differenceExacte(0.3, 0.1)).toBe(0.2);
  });

  it("rend un rapport à 4 décimales, ou null si le dénominateur est nul", () => {
    expect(ratio({ num: 1n, den: 1n }, { num: 3n, den: 1n })).toBe(0.3333);
    expect(ratio({ num: 2n, den: 1n }, { num: 3n, den: 1n })).toBe(0.6667);
    expect(ratio({ num: -1n, den: 1n }, { num: 8n, den: 1n })).toBe(-0.125);
    expect(ratio({ num: 5n, den: 1n }, { num: 0n, den: 1n })).toBeNull();
  });

  it("refuse un entier hors de la plage sûre", () => {
    expect(versEntierSur(42n)).toBe(42);
    expect(() => versEntierSur(2n ** 60n)).toThrow(ErreurFinance);
  });
});
