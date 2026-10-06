import { describe, expect, it } from "vitest";
import {
  aujourdhui,
  dateValide,
  debutDAnnee,
  debutDuMois,
  erreurPeriode,
  lirePeriode,
} from "./periode";

describe("dates et périodes", () => {
  it("valide une date calendaire réelle dans la plage de l'API", () => {
    expect(dateValide("2027-02-28")).toBe("2027-02-28");
    expect(dateValide("2027-02-30")).toBeNull();
    expect(dateValide("1999-12-31")).toBeNull();
    expect(dateValide("31/01/2027")).toBeNull();
    expect(dateValide("")).toBeNull();
  });

  it("donne le jour, le début du mois et de l'année", () => {
    expect(aujourdhui(new Date("2027-03-15T23:30:00Z"))).toBe("2027-03-15");
    expect(debutDuMois("2027-03-15")).toBe("2027-03-01");
    expect(debutDAnnee("2027-03-15")).toBe("2027-01-01");
  });

  it("lit une période d'URL et retombe sur la période par défaut si elle est fausse", () => {
    const defaut = { du: "2027-03-01", au: "2027-03-15" };
    expect(lirePeriode({ du: "2027-01-01", au: "2027-02-01" }, defaut)).toEqual({
      du: "2027-01-01",
      au: "2027-02-01",
      corrigee: false,
    });
    expect(lirePeriode({}, defaut)).toEqual({ ...defaut, corrigee: false });
    expect(lirePeriode({ du: "2027-05-01", au: "2027-04-01" }, defaut)).toEqual({
      ...defaut,
      corrigee: true,
    });
    expect(lirePeriode({ du: "n'importe quoi" }, defaut).corrigee).toBe(true);
    expect(lirePeriode({ du: ["2027-02-01", "x"] }, defaut).du).toBe("2027-02-01");
    expect(lirePeriode({ du: "2026-01-01", au: "2027-01-02" }, defaut, 366)).toEqual({
      ...defaut,
      corrigee: true,
    });
    expect(lirePeriode({ du: "2026-01-01", au: "2027-01-01" }, defaut, 366).corrigee).toBe(false);
  });

  it("contrôle une période saisie", () => {
    expect(erreurPeriode("2027-01-01", "2027-01-31")).toBeNull();
    expect(erreurPeriode("2027-02-01", "2027-01-31")).toMatch(/précède/);
    expect(erreurPeriode("", "2027-01-31")).toMatch(/dates valides/);
  });
});
