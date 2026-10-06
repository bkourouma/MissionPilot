import { describe, expect, it } from "vitest";
import { ajouterMois, joursDepuisEpoque, joursEntre } from "./dates";

describe("dates calendaires", () => {
  it("compte les jours entre deux dates", () => {
    expect(joursEntre("2026-01-01", "2026-03-01")).toBe(59);
    expect(joursEntre("2026-03-01", "2026-01-01")).toBe(-59);
    expect(joursDepuisEpoque("1970-01-02")).toBe(1);
  });

  it("refuse un format ou une date inexistante", () => {
    expect(() => joursDepuisEpoque("2026-1-1")).toThrow(/AAAA-MM-JJ/);
    expect(() => joursDepuisEpoque("2026-02-30")).toThrow(/inexistante/);
  });

  it("ajoute des mois en ramenant au dernier jour du mois", () => {
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
    expect(ajouterMois("2024-01-31", 1)).toBe("2024-02-29");
    expect(ajouterMois("2026-11-15", 3)).toBe("2027-02-15");
    expect(ajouterMois("2026-03-31", -1)).toBe("2026-02-28");
    expect(ajouterMois("2026-01-15", -1)).toBe("2025-12-15");
    expect(() => ajouterMois("2026-13-01", 1)).toThrow();
  });
});
