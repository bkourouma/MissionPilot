import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import {
  joursDansPeriodeKpi,
  periodeKpiDe,
  periodeKpiDepuisRang,
  periodeKpiPrecedente,
  periodeKpiSuivante,
  periodesKpiEntre,
  type FrequenceKpi,
} from "./periodes";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

describe("périodes de mesure", () => {
  it.each<[string, FrequenceKpi, string, string, string]>([
    ["2026-10-06", "mensuelle", "2026-10", "2026-10-01", "2026-10-31"],
    ["2024-02-10", "mensuelle", "2024-02", "2024-02-01", "2024-02-29"],
    ["2026-05-15", "trimestrielle", "2026-T2", "2026-04-01", "2026-06-30"],
    ["2026-12-31", "trimestrielle", "2026-T4", "2026-10-01", "2026-12-31"],
    ["2026-07-01", "semestrielle", "2026-S2", "2026-07-01", "2026-12-31"],
    ["2026-06-30", "semestrielle", "2026-S1", "2026-01-01", "2026-06-30"],
    ["2026-03-03", "annuelle", "2026", "2026-01-01", "2026-12-31"],
    ["2026-10-06", "hebdomadaire", "2026-W41", "2026-10-05", "2026-10-11"],
    // Semaines ISO à cheval sur deux années.
    ["2021-01-03", "hebdomadaire", "2020-W53", "2020-12-28", "2021-01-03"],
    ["2024-12-30", "hebdomadaire", "2025-W01", "2024-12-30", "2025-01-05"],
    ["2026-01-01", "hebdomadaire", "2026-W01", "2025-12-29", "2026-01-04"],
  ])("%s en %s → %s (%s → %s)", (date, frequence, cle, debut, fin) => {
    expect(periodeKpiDe(date, frequence)).toMatchObject({ frequence, cle, debut, fin });
  });

  it("enchaîne les périodes suivantes et précédentes", () => {
    expect(periodeKpiSuivante(periodeKpiDe("2026-12-15", "mensuelle")).cle).toBe("2027-01");
    expect(periodeKpiPrecedente(periodeKpiDe("2026-01-15", "trimestrielle")).cle).toBe("2025-T4");
    expect(periodeKpiSuivante(periodeKpiDe("2020-12-31", "hebdomadaire"))).toMatchObject({
      cle: "2021-W01",
      debut: "2021-01-04",
    });
    expect(periodeKpiPrecedente(periodeKpiDe("2026-03-01", "annuelle")).cle).toBe("2025");
    expect(periodeKpiSuivante(periodeKpiDe("2026-03-01", "semestrielle")).cle).toBe("2026-S2");
  });

  it("compte les jours d'une période", () => {
    expect(joursDansPeriodeKpi(periodeKpiDe("2024-02-01", "trimestrielle"))).toBe(91);
    expect(joursDansPeriodeKpi(periodeKpiDe("2025-02-01", "mensuelle"))).toBe(28);
    expect(joursDansPeriodeKpi(periodeKpiDe("2025-02-01", "hebdomadaire"))).toBe(7);
    expect(joursDansPeriodeKpi(periodeKpiDe("2024-06-01", "annuelle"))).toBe(366);
  });

  it("énumère les périodes d'un intervalle, bornes incluses", () => {
    expect(periodesKpiEntre("2026-01-15", "2026-04-02", "mensuelle").map((p) => p.cle)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(periodesKpiEntre("2026-02-01", "2026-02-28", "trimestrielle")).toHaveLength(1);
  });

  it("refuse un intervalle inversé ou démesuré", () => {
    expect(codeErreur(() => periodesKpiEntre("2026-04-01", "2026-01-01", "mensuelle"))).toBe(
      "PERIODE_INVALIDE",
    );
    expect(codeErreur(() => periodesKpiEntre("1900-01-01", "2200-01-01", "hebdomadaire"))).toBe(
      "PERIODE_INVALIDE",
    );
  });

  it("refuse une date invalide et un rang non entier", () => {
    expect(codeErreur(() => periodeKpiDe("2026-02-30", "mensuelle"))).toBe("DATE_INVALIDE");
    expect(codeErreur(() => periodeKpiDe("06/10/2026", "mensuelle"))).toBe("DATE_INVALIDE");
    expect(codeErreur(() => periodeKpiDepuisRang("mensuelle", 1.5))).toBe("PERIODE_INVALIDE");
  });

  it("propriété : chaque jour tombe dans sa période, et les périodes se jouxtent", () => {
    const frequences: FrequenceKpi[] = [
      "hebdomadaire",
      "mensuelle",
      "trimestrielle",
      "semestrielle",
      "annuelle",
    ];
    const debut = Date.UTC(2019, 0, 1);
    for (const frequence of frequences) {
      for (let j = 0; j < 3 * 366; j += 3) {
        const date = new Date(debut + j * 86_400_000).toISOString().slice(0, 10);
        const p = periodeKpiDe(date, frequence);
        expect(p.debut <= date && date <= p.fin).toBe(true);
        const suivante = periodeKpiSuivante(p);
        const lendemain = new Date(Date.parse(p.fin) + 86_400_000).toISOString().slice(0, 10);
        expect(suivante.debut).toBe(lendemain);
        expect(periodeKpiDepuisRang(frequence, p.rang)).toEqual(p);
      }
    }
  });
});
