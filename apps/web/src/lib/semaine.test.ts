import { describe, expect, it } from "vitest";
import {
  ajouterJoursIso,
  dansPeriode,
  estDateIso,
  joursDeLaSemaine,
  libelleJourCourt,
  libelleJourLong,
  libelleSemaine,
  lireSemaine,
  lundiDe,
  navigationSemaine,
} from "./semaine";

describe("dates ISO", () => {
  it("accepte une date civile valide entre 2000 et 2100", () => {
    expect(estDateIso("2026-10-05")).toBe(true);
    expect(estDateIso("2026-02-30")).toBe(false);
    expect(estDateIso("1999-12-31")).toBe(false);
    expect(estDateIso("2026-10-5")).toBe(false);
    expect(estDateIso(42)).toBe(false);
  });

  it("lit le paramètre ?semaine= ou l'ignore", () => {
    expect(lireSemaine("2026-10-07")).toBe("2026-10-07");
    expect(lireSemaine(["2026-10-07", "x"])).toBe("2026-10-07");
    expect(lireSemaine("<script>")).toBeUndefined();
    expect(lireSemaine(undefined)).toBeUndefined();
  });

  it("ajoute des jours en traversant mois et années", () => {
    expect(ajouterJoursIso("2026-12-29", 7)).toBe("2027-01-05");
    expect(ajouterJoursIso("2026-03-02", -7)).toBe("2026-02-23");
  });

  it("donne le lundi et les sept jours de la semaine", () => {
    expect(lundiDe("2026-10-11")).toBe("2026-10-05"); // dimanche
    expect(lundiDe("2026-10-05")).toBe("2026-10-05");
    expect(joursDeLaSemaine("2026-10-05")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });

  it("teste l'appartenance à une période, bornes incluses", () => {
    expect(dansPeriode("2026-10-05", "2026-10-05", "2026-10-09")).toBe(true);
    expect(dansPeriode("2026-10-10", "2026-10-05", "2026-10-09")).toBe(false);
  });
});

describe("libellés", () => {
  it("nomme les jours en français", () => {
    expect(libelleJourLong("2026-10-05")).toBe("Lundi 5 octobre");
    expect(libelleJourCourt("2026-10-05")).toBe("lun. 5");
  });

  it("nomme une semaine sans répéter mois ni année inutilement", () => {
    expect(libelleSemaine("2026-10-05", "2026-10-11")).toBe("Semaine du 5 au 11 octobre 2026");
    expect(libelleSemaine("2026-09-28", "2026-10-04")).toBe(
      "Semaine du 28 septembre au 4 octobre 2026",
    );
    expect(libelleSemaine("2026-12-28", "2027-01-03")).toBe(
      "Semaine du 28 décembre 2026 au 3 janvier 2027",
    );
  });
});

describe("navigationSemaine", () => {
  it("propose précédente, suivante et un retour à la semaine courante", () => {
    const n = navigationSemaine("/temps", "2026-09-28", "2026-10-06");
    expect(n.precedente).toBe("/temps?semaine=2026-09-21");
    expect(n.suivante).toBe("/temps?semaine=2026-10-05");
    expect(n.courante).toBe("/temps");
  });

  it("n'offre pas « cette semaine » quand on y est déjà", () => {
    expect(navigationSemaine("/planning", "2026-10-05", "2026-10-06").courante).toBeNull();
  });
});
