import { describe, expect, it } from "vitest";
import { syntheseNps } from "../src/qualite/nps.js";

describe("syntheseNps (QUA-08)", () => {
  it("sans réponse : pas de NPS", () => {
    expect(syntheseNps([])).toEqual({
      total: 0,
      promoteurs: 0,
      passifs: 0,
      detracteurs: 0,
      nps: null,
    });
  });

  it("classe promoteurs 9-10, passifs 7-8, détracteurs 0-6", () => {
    const r = syntheseNps([10, 9, 8, 7, 6, 0]);
    expect(r).toMatchObject({ total: 6, promoteurs: 2, passifs: 2, detracteurs: 2, nps: "0.0" });
  });

  it("arrondit au dixième, au plus loin de zéro à égalité", () => {
    expect(syntheseNps([10, 8, 8]).nps).toBe("33.3");
    expect(syntheseNps([0, 8, 8]).nps).toBe("-33.3");
    expect(syntheseNps([10, 10, 9, 9, 8, 0, 3]).nps).toBe("28.6");
    expect(syntheseNps([10]).nps).toBe("100.0");
    expect(syntheseNps([0]).nps).toBe("-100.0");
    // 1/8 = 12,5 % → 12.5 ; 1/16 = 6,25 % → 6.3 (moitié vers le haut en valeur absolue)
    expect(syntheseNps([10, 8, 8, 8, 8, 8, 8, 8]).nps).toBe("12.5");
    expect(syntheseNps([10, ...Array<number>(15).fill(8)]).nps).toBe("6.3");
    expect(syntheseNps([0, ...Array<number>(15).fill(8)]).nps).toBe("-6.3");
  });

  it("refuse une note hors de 0 à 10", () => {
    expect(() => syntheseNps([11])).toThrow(RangeError);
    expect(() => syntheseNps([-1])).toThrow(RangeError);
    expect(() => syntheseNps([7.5])).toThrow(RangeError);
  });
});
