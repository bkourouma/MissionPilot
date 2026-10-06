import { describe, expect, it } from "vitest";
import {
  ajouterJours,
  dansPeriode,
  dateISO,
  ecartJours,
  intersection,
  jourSemaine,
  lundiDeLaSemaine,
  periodeDuMois,
  verifierPeriode,
  versDateISO,
  versJourUTC,
} from "./dates";

describe("dates ISO en jours UTC", () => {
  it("convertit aller-retour sans fuseau", () => {
    expect(versJourUTC("1970-01-01")).toBe(0);
    expect(versJourUTC("1969-12-31")).toBe(-1);
    expect(versDateISO(versJourUTC("2024-02-29"))).toBe("2024-02-29");
    expect(dateISO(2024, 3, 5)).toBe("2024-03-05");
    expect(dateISO(999, 1, 1)).toBe("0999-01-01");
  });

  it("refuse les formats et dates invalides", () => {
    expect(() => versJourUTC("2024-2-1")).toThrow(RangeError);
    expect(() => versJourUTC("2023-02-29")).toThrow(/inexistante/);
    expect(() => versJourUTC("2024-13-01")).toThrow(RangeError);
  });

  it("calcule le jour de la semaine ISO", () => {
    expect(jourSemaine("2024-01-01")).toBe(1); // lundi
    expect(jourSemaine("2024-01-07")).toBe(7); // dimanche
    expect(jourSemaine("1969-12-31")).toBe(3); // mercredi, avant l'époque
    expect(jourSemaine("2026-10-06")).toBe(2); // mardi
  });

  it("ajoute des jours et mesure un écart", () => {
    expect(ajouterJours("2024-02-28", 2)).toBe("2024-03-01");
    expect(ajouterJours("2024-01-01", -1)).toBe("2023-12-31");
    expect(ecartJours("2024-01-01", "2024-12-31")).toBe(365);
  });

  it("manipule les périodes", () => {
    const p = { debut: "2024-01-10", fin: "2024-01-20" };
    expect(dansPeriode("2024-01-10", p)).toBe(true);
    expect(dansPeriode("2024-01-21", p)).toBe(false);
    expect(dansPeriode("2024-01-09", p)).toBe(false);
    expect(intersection(p, { debut: "2024-01-15", fin: "2024-02-01" })).toEqual({
      debut: "2024-01-15",
      fin: "2024-01-20",
    });
    expect(intersection(p, { debut: "2024-01-21", fin: "2024-02-01" })).toBeNull();
    expect(() => verifierPeriode({ debut: "2024-01-02", fin: "2024-01-01" })).toThrow(/inversée/);
    expect(() => verifierPeriode(p)).not.toThrow();
  });

  it("trouve le lundi de la semaine", () => {
    expect(lundiDeLaSemaine("2024-01-07")).toBe("2024-01-01");
    expect(lundiDeLaSemaine("2024-01-01")).toBe("2024-01-01");
  });

  it("donne la période d'un mois", () => {
    expect(periodeDuMois("2024-02")).toEqual({ debut: "2024-02-01", fin: "2024-02-29" });
    expect(periodeDuMois("2024-12")).toEqual({ debut: "2024-12-01", fin: "2024-12-31" });
    expect(() => periodeDuMois("2024-13")).toThrow(RangeError);
    expect(() => periodeDuMois("2024-00")).toThrow(RangeError);
    expect(() => periodeDuMois("24-01")).toThrow(RangeError);
  });
});
