import { describe, expect, it } from "vitest";
import {
  ajouterJoursOuvres,
  estJourOuvre,
  joursOuvresEntre,
  listerJoursOuvres,
} from "./calendrier";

describe("jours ouvrés", () => {
  it("exclut le week-end par défaut", () => {
    expect(estJourOuvre("2024-01-05")).toBe(true); // vendredi
    expect(estJourOuvre("2024-01-06")).toBe(false); // samedi
    expect(joursOuvresEntre("2024-01-01", "2024-01-07")).toBe(5);
  });

  it("exclut un férié tombant en semaine", () => {
    const cal = { feries: ["2024-01-01"] };
    expect(estJourOuvre("2024-01-01", cal)).toBe(false);
    expect(joursOuvresEntre("2024-01-01", "2024-01-07", cal)).toBe(4);
  });

  it("accepte une semaine de travail paramétrable", () => {
    expect(
      joursOuvresEntre("2024-01-01", "2024-01-07", { joursTravailles: [1, 2, 3, 4, 5, 6] }),
    ).toBe(6);
    expect(() => estJourOuvre("2024-01-01", { joursTravailles: [0] })).toThrow(RangeError);
    expect(() => estJourOuvre("2024-01-01", { joursTravailles: [1.5] })).toThrow(RangeError);
  });

  it("renvoie 0 pour une période inversée et liste les jours", () => {
    expect(joursOuvresEntre("2024-01-07", "2024-01-01")).toBe(0);
    expect(listerJoursOuvres({ debut: "2024-01-05", fin: "2024-01-08" })).toEqual([
      "2024-01-05",
      "2024-01-08",
    ]);
  });

  it("ajoute et retire des jours ouvrés", () => {
    expect(ajouterJoursOuvres("2024-01-05", 1)).toBe("2024-01-08");
    expect(ajouterJoursOuvres("2024-01-05", 1, { feries: ["2024-01-08"] })).toBe("2024-01-09");
    expect(ajouterJoursOuvres("2024-01-06", 0)).toBe("2024-01-08");
    expect(ajouterJoursOuvres("2024-01-03", 0)).toBe("2024-01-03");
    expect(ajouterJoursOuvres("2024-01-08", -1)).toBe("2024-01-05");
    expect(ajouterJoursOuvres("2024-01-01", 10)).toBe("2024-01-15");
  });

  it("refuse un décalage non entier ou un calendrier vide", () => {
    expect(() => ajouterJoursOuvres("2024-01-01", 1.5)).toThrow(RangeError);
    expect(() => ajouterJoursOuvres("2024-01-01", 1, { joursTravailles: [] })).toThrow(/aucun/);
  });
});
