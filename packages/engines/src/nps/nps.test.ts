import { describe, expect, it } from "vitest";
import { ErreurNps, estNoteSatisfaction, syntheseNps } from "./index";

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
    expect(r).toEqual({ total: 6, promoteurs: 2, passifs: 2, detracteurs: 2, nps: "0.0" });
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

  it("un écart minuscule négatif arrondi à zéro n'affiche pas « -0.0 »", () => {
    const notes = [0, ...Array<number>(2000).fill(8)];
    expect(syntheseNps(notes).nps).toBe("0.0");
  });

  it("refuse une note hors de 0 à 10 (erreur typée du moteur)", () => {
    for (const n of [11, -1, 7.5, Number.NaN]) {
      expect(estNoteSatisfaction(n)).toBe(false);
      expect(() => syntheseNps([n])).toThrow(ErreurNps);
    }
    try {
      syntheseNps([11]);
    } catch (e) {
      expect((e as ErreurNps).code).toBe("NOTE_INVALIDE");
    }
    expect(estNoteSatisfaction(0)).toBe(true);
    expect(estNoteSatisfaction(10)).toBe(true);
  });
});
