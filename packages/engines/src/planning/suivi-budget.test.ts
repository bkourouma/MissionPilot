import { describe, expect, it } from "vitest";
import {
  avancementPhysique,
  calculerSuivi,
  detecterAlertes,
  performanceMission,
  sommerLignes,
  statutCouleur,
} from "./suivi-budget";

describe("calcul de suivi (TPS-05)", () => {
  it("calcule atterrissage, écart et consommation", () => {
    expect(calculerSuivi({ budget: 15, realise: 6, resteAFaire: 10 })).toEqual({
      budget: 15,
      realise: 6,
      resteAFaire: 10,
      atterrissage: 16,
      ecart: 1,
      ecartRelatif: 0.0667,
      consommation: 0.4,
    });
  });

  it("arrondit les ratios à 4 décimales (demi s'éloignant de zéro)", () => {
    expect(calculerSuivi({ budget: 12, realise: 10, resteAFaire: 0 })).toMatchObject({
      consommation: 0.8333,
      ecartRelatif: -0.1667,
    });
    expect(calculerSuivi({ budget: 3, realise: 2, resteAFaire: 0 }).consommation).toBe(0.6667);
    // 1 / 20 000 = 0,00005 → 0,0001
    expect(calculerSuivi({ budget: 200, realise: 0.01, resteAFaire: 0 }).consommation).toBe(0.0001);
  });

  it("ne divise jamais par un budget nul", () => {
    const s = calculerSuivi({ budget: 0, realise: 2, resteAFaire: 1 });
    expect(s.consommation).toBeNull();
    expect(s.ecartRelatif).toBeNull();
    expect(s.ecart).toBe(3);
  });

  it("évite les erreurs flottantes", () => {
    expect(calculerSuivi({ budget: 0.3, realise: 0.1, resteAFaire: 0.2 }).ecart).toBe(0);
    expect(
      sommerLignes([
        { budget: 0.1, realise: 0.1, resteAFaire: 0.1 },
        { budget: 0.2, realise: 0.2, resteAFaire: 0.2 },
      ]),
    ).toEqual({ budget: 0.3, realise: 0.3, resteAFaire: 0.3 });
  });

  it("refuse les valeurs négatives ou non finies", () => {
    expect(() => calculerSuivi({ budget: -1, realise: 0, resteAFaire: 0 })).toThrow(/Budget/);
    expect(() => calculerSuivi({ budget: 1, realise: Number.NaN, resteAFaire: 0 })).toThrow(
      /Réalisé/,
    );
    expect(() => calculerSuivi({ budget: 1, realise: 0, resteAFaire: -0.5 })).toThrow(/Reste/);
  });
});

describe("couleurs et alertes (TPS-06, TPS-07)", () => {
  it("passe à l'orange à 80 % de consommation pile", () => {
    expect(statutCouleur({ budget: 10, realise: 8, resteAFaire: 2 })).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 7.9, resteAFaire: 2 })).toBe("vert");
  });

  it("gère le budget nul", () => {
    expect(statutCouleur({ budget: 0, realise: 0, resteAFaire: 0 })).toBe("vert");
    expect(statutCouleur({ budget: 0, realise: 0, resteAFaire: 0.5 })).toBe("rouge");
    expect(detecterAlertes({ budget: 0, realise: 0, resteAFaire: 0 })).toEqual([]);
    expect(detecterAlertes({ budget: 0, realise: 1, resteAFaire: 0 }).map((a) => a.type)).toEqual([
      "consommation_seuil",
      "atterrissage_superieur_budget",
    ]);
  });

  it("formate l'écart en jours avec une virgule décimale", () => {
    const message = (resteAFaire: number) =>
      detecterAlertes({ budget: 10, realise: 1, resteAFaire }).find(
        (a) => a.type === "atterrissage_superieur_budget",
      )?.message;
    expect(message(11.5)).toBe("Atterrissage supérieur au budget de 2,5 j");
    expect(message(10.25)).toBe("Atterrissage supérieur au budget de 1,25 j");
    expect(message(12)).toBe("Atterrissage supérieur au budget de 3 j");
    expect(message(9.1)).toBe("Atterrissage supérieur au budget de 0,1 j");
  });

  it("accepte des seuils paramétrés", () => {
    const seuils = {
      consommationOrangePct: 90,
      atterrissageOrangePct: 110,
      atterrissageRougePct: 120,
    };
    expect(statutCouleur({ budget: 10, realise: 8, resteAFaire: 3 }, seuils)).toBe("vert");
    expect(statutCouleur({ budget: 10, realise: 9, resteAFaire: 0 }, seuils)).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 5, resteAFaire: 6.5 }, seuils)).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 5, resteAFaire: 7.5 }, seuils)).toBe("rouge");
    expect(detecterAlertes({ budget: 10, realise: 8, resteAFaire: 2 }, 90)).toEqual([]);
    expect(detecterAlertes({ budget: 10, realise: 9, resteAFaire: 1 }, 90)[0]?.message).toMatch(
      /90 %/,
    );
  });
});

describe("avancement physique et performance (TPS-08)", () => {
  it("pondère les livrables et jalons", () => {
    expect(avancementPhysique([])).toBeNull();
    expect(avancementPhysique([{ atteint: true }, { atteint: false }])).toBe(0.5);
    expect(
      avancementPhysique([
        { atteint: true, poids: 3 },
        { atteint: false, poids: 1 },
      ]),
    ).toBe(0.75);
    expect(avancementPhysique([{ atteint: true }, { atteint: false }, { atteint: false }])).toBe(
      0.3333,
    );
    expect(avancementPhysique([{ atteint: false, poids: 0 }])).toBeNull();
    expect(() => avancementPhysique([{ atteint: true, poids: -1 }])).toThrow(/Poids/);
  });

  it("compare l'avancement au consommé", () => {
    const p = performanceMission(0.4, { budget: 50, realise: 26.5 });
    expect(p.consommation).toBe(0.53);
    expect(p.indice).toBe(0.7547);
    expect(p.ecartPoints).toBe(-0.13);
    expect(performanceMission(0.6, { budget: 10, realise: 5 }).indice).toBe(1.2);
    expect(performanceMission(0.5, { budget: 12, realise: 10 })).toMatchObject({
      consommation: 0.8333,
      indice: 0.6,
      ecartPoints: -0.3333,
    });
  });

  it("renvoie null sans consommation ou sans budget", () => {
    expect(performanceMission(0.2, { budget: 10, realise: 0 })).toEqual({
      avancement: 0.2,
      consommation: 0,
      indice: null,
      ecartPoints: 0.2,
    });
    expect(performanceMission(0.2, { budget: 0, realise: 3 })).toMatchObject({
      consommation: null,
      indice: null,
      ecartPoints: null,
    });
  });

  it("refuse un avancement hors [0 ; 1]", () => {
    expect(() => performanceMission(1.2, { budget: 1, realise: 1 })).toThrow(RangeError);
    expect(() => performanceMission(-0.1, { budget: 1, realise: 1 })).toThrow(RangeError);
    expect(() => performanceMission(Number.NaN, { budget: 1, realise: 1 })).toThrow(RangeError);
  });
});
