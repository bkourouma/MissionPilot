import { describe, expect, it } from "vitest";
import { joursOuvresEntre } from "./calendrier";
import { PAYS_UEMOA, type PaysUEMOA, feriesParDefaut, fetesMobiles, paques } from "./feries";

describe("Pâques et fêtes mobiles", () => {
  it("calcule Pâques (Meeus/Jones/Butcher)", () => {
    expect(paques(2024)).toBe("2024-03-31");
    expect(paques(2025)).toBe("2025-04-20");
    expect(paques(2019)).toBe("2019-04-21");
    expect(paques(2000)).toBe("2000-04-23");
    expect(paques(1818)).toBe("1818-03-22"); // la plus précoce possible
    expect(paques(2038)).toBe("2038-04-25"); // la plus tardive possible
    expect(() => paques(1582)).toThrow(RangeError);
    expect(() => paques(2024.5)).toThrow(RangeError);
  });

  it("dérive lundi de Pâques, Ascension et lundi de Pentecôte", () => {
    expect(fetesMobiles(2024).map((f) => f.date)).toEqual([
      "2024-04-01",
      "2024-05-09",
      "2024-05-20",
    ]);
    expect(fetesMobiles(2025).map((f) => f.date)).toEqual([
      "2025-04-21",
      "2025-05-29",
      "2025-06-09",
    ]);
  });
});

describe("fériés par défaut UEMOA", () => {
  it("donne le calendrier ivoirien 2024 trié", () => {
    expect(feriesParDefaut("CI", 2024).map((f) => f.date)).toEqual([
      "2024-01-01",
      "2024-04-01",
      "2024-05-01",
      "2024-05-09",
      "2024-05-20",
      "2024-08-07",
      "2024-08-15",
      "2024-11-01",
      "2024-11-15",
      "2024-12-25",
    ]);
  });

  it("garde les deux fêtes quand elles coïncident (Ascension le 1er mai 2008)", () => {
    const mai = feriesParDefaut("CI", 2008).filter((f) => f.date === "2008-05-01");
    expect(mai.map((f) => f.libelle).sort()).toEqual(["Ascension", "Fête du Travail"]);
  });

  it("couvre les 8 pays avec leur fête d'indépendance", () => {
    const independance: Record<PaysUEMOA, string> = {
      CI: "2025-08-07",
      SN: "2025-04-04",
      ML: "2025-09-22",
      BF: "2025-08-05",
      BJ: "2025-08-01",
      TG: "2025-04-27",
      NE: "2025-08-03",
      GW: "2025-09-24",
    };
    for (const pays of PAYS_UEMOA) {
      const f = feriesParDefaut(pays, 2025);
      expect(f[0]?.date).toBe("2025-01-01");
      expect(f.find((x) => x.date === independance[pays])?.libelle).toMatch(/Indépendance/);
    }
  });

  it("n'applique que les fêtes mobiles du pays", () => {
    expect(feriesParDefaut("GW", 2024).some((f) => f.date === "2024-04-01")).toBe(false);
    expect(feriesParDefaut("ML", 2024).some((f) => f.date === "2024-05-09")).toBe(false);
    expect(feriesParDefaut("SN", 2024).some((f) => f.date === "2024-05-20")).toBe(true);
  });

  it("refuse un pays hors UEMOA", () => {
    expect(() => feriesParDefaut("FR" as PaysUEMOA, 2024)).toThrow(/hors UEMOA/);
  });

  it("s'intègre au calcul des jours ouvrés", () => {
    const feries = feriesParDefaut("CI", 2024).map((f) => f.date);
    // Semaine du lundi de Pâques 2024 : 4 jours ouvrés.
    expect(joursOuvresEntre("2024-04-01", "2024-04-07", { feries })).toBe(4);
  });
});
