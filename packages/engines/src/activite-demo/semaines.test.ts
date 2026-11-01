import { describe, expect, it } from "vitest";
import {
  estLundiDuMoisDemo,
  fenetreDuMoisDemo,
  jourEvenementDemo,
  libelleMoisDemo,
  libelleSemaineDemo,
  lundisDuMoisDemo,
  lundisRestantsDemo,
  moisDeDateDemo,
  PARAMETRES_ACTIVITE_DEMO,
  semainesAGenererDemo,
} from "./index";

describe("lundis du mois", () => {
  it("novembre 2026 : 2, 9, 16, 23 et 30", () => {
    expect(lundisDuMoisDemo("2026-11")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
  });

  it("un mois qui commence un lundi garde son 1er (février 2027)", () => {
    expect(lundisDuMoisDemo("2027-02")).toEqual([
      "2027-02-01",
      "2027-02-08",
      "2027-02-15",
      "2027-02-22",
    ]);
  });

  it("refuse un mois invalide", () => {
    expect(() => lundisDuMoisDemo("2026-13")).toThrow(RangeError);
  });
});

describe("semaines à générer et tâches de suite", () => {
  it("au 1er novembre : la semaine du 26 octobre, et les cinq lundis de novembre en suite", () => {
    expect(semainesAGenererDemo("2026-11", "2026-11-01")).toEqual(["2026-10-26"]);
    expect(lundisRestantsDemo("2026-11", "2026-11-01")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
  });

  it("au 18 novembre (retard) : du 26 octobre au 16 novembre", () => {
    expect(semainesAGenererDemo("2026-11", "2026-11-18")).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
    expect(lundisRestantsDemo("2026-11", "2026-11-18")).toEqual(["2026-11-23", "2026-11-30"]);
  });

  it("avant le 1er du mois : rien", () => {
    expect(semainesAGenererDemo("2026-11", "2026-10-31")).toEqual([]);
  });

  it("au 3 décembre pour novembre : six semaines, aucune suite", () => {
    expect(semainesAGenererDemo("2026-11", "2026-12-03")).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    expect(lundisRestantsDemo("2026-11", "2026-12-03")).toEqual([]);
  });

  it("au 1er décembre : la semaine du 30 novembre, puis 7, 14, 21 et 28 en suite", () => {
    expect(semainesAGenererDemo("2026-12", "2026-12-01")).toEqual(["2026-11-30"]);
    expect(lundisRestantsDemo("2026-12", "2026-12-01")).toEqual([
      "2026-12-07",
      "2026-12-14",
      "2026-12-21",
      "2026-12-28",
    ]);
  });

  it("février 2027, dont le 1er est un lundi : la seule semaine du 1er", () => {
    expect(semainesAGenererDemo("2027-02", "2027-02-01")).toEqual(["2027-02-01"]);
  });

  it("garde les semaines les plus récentes, dans la limite demandée", () => {
    expect(semainesAGenererDemo("2026-11", "2026-12-03", 2)).toEqual(["2026-11-23", "2026-11-30"]);
    expect(semainesAGenererDemo("2026-11", "2026-12-03", 0)).toEqual([]);
    expect(PARAMETRES_ACTIVITE_DEMO.semainesMax).toBe(6);
  });

  it("refuse une limite négative ou non entière, et une date invalide", () => {
    expect(() => semainesAGenererDemo("2026-11", "2026-11-01", -1)).toThrow(RangeError);
    expect(() => semainesAGenererDemo("2026-11", "2026-11-01", 1.5)).toThrow(RangeError);
    expect(() => semainesAGenererDemo("2026-11", "2026-11-31")).toThrow(RangeError);
  });
});

describe("lundi d'une tâche de suite", () => {
  it("accepte un lundi du mois", () => {
    expect(estLundiDuMoisDemo("2026-11", "2026-11-02")).toBe(true);
    expect(estLundiDuMoisDemo("2026-11", "2026-11-30")).toBe(true);
  });

  it("refuse un mardi, un lundi d'un autre mois et une date invalide, sans lever", () => {
    expect(estLundiDuMoisDemo("2026-11", "2026-11-03")).toBe(false);
    expect(estLundiDuMoisDemo("2026-11", "2026-10-26")).toBe(false);
    expect(estLundiDuMoisDemo("2026-11", "2026-12-07")).toBe(false);
    expect(estLundiDuMoisDemo("2026-11", "2026-11-31")).toBe(false);
    expect(estLundiDuMoisDemo("2026-13", "2026-11-02")).toBe(false);
  });
});

describe("fenêtre du mois", () => {
  it("2026-11 : du 26 octobre au 6 décembre", () => {
    expect(fenetreDuMoisDemo("2026-11")).toEqual({ debut: "2026-10-26", fin: "2026-12-06" });
  });

  it("2027-03 : du 1er mars au 4 avril", () => {
    expect(fenetreDuMoisDemo("2027-03")).toEqual({ debut: "2027-03-01", fin: "2027-04-04" });
  });
});

describe("jour des événements de la semaine", () => {
  it("semaine courante : le jour lui-même, du lundi au dimanche", () => {
    expect(jourEvenementDemo("2026-10-26", "2026-11-01")).toBe("2026-11-01");
    expect(jourEvenementDemo("2026-10-26", "2026-10-26")).toBe("2026-10-26");
  });

  it("semaine passée ou à venir : null", () => {
    expect(jourEvenementDemo("2026-10-19", "2026-11-01")).toBeNull();
    expect(jourEvenementDemo("2026-11-02", "2026-11-01")).toBeNull();
  });

  it("refuse un lundi qui n'en est pas un, et un jour invalide", () => {
    expect(() => jourEvenementDemo("2026-10-27", "2026-11-01")).toThrow(RangeError);
    expect(() => jourEvenementDemo("2026-10-26", "2026-02-30")).toThrow(RangeError);
  });
});

describe("mois et libellés", () => {
  it("mois d'une date", () => {
    expect(moisDeDateDemo("2026-11-01")).toBe("2026-11");
    expect(() => moisDeDateDemo("2026-11-31")).toThrow(RangeError);
  });

  it("libellé du mois, table fixe", () => {
    expect(libelleMoisDemo("2026-11")).toBe("novembre 2026");
    expect(libelleMoisDemo("2027-02")).toBe("février 2027");
    expect(libelleMoisDemo("2026-08")).toBe("août 2026");
    expect(libelleMoisDemo("2026-12")).toBe("décembre 2026");
    expect(libelleMoisDemo("2027-01")).toBe("janvier 2027");
    expect(() => libelleMoisDemo("2026-00")).toThrow(RangeError);
  });

  it("libellé de la semaine, « 1er » pour le premier du mois", () => {
    expect(libelleSemaineDemo("2026-10-26")).toBe("semaine du 26 octobre 2026");
    expect(libelleSemaineDemo("2027-02-01")).toBe("semaine du 1er février 2027");
    expect(libelleSemaineDemo("2026-11-09")).toBe("semaine du 9 novembre 2026");
    expect(() => libelleSemaineDemo("2026-10-27")).toThrow(RangeError);
  });
});
