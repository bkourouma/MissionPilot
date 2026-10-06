import { describe, expect, it } from "vitest";
import { agregationKpiParDefaut, agregerKpiParPeriode, type MesureKpi } from "./agregation";
import { ErreurKpi } from "./erreurs";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

const MESURES: MesureKpi[] = [
  { date: "2026-01-10", valeur: 10 },
  { date: "2026-01-20", valeur: 5 },
  { date: "2026-03-05", valeur: 7 },
];

function valeurs(series: ReturnType<typeof agregerKpiParPeriode>): (number | null)[] {
  return series.map((s) => s.valeur);
}

describe("agrégation par période", () => {
  it("choisit l'agrégation selon la nature", () => {
    expect(agregationKpiParDefaut("flux")).toBe("somme");
    expect(agregationKpiParDefaut("stock")).toBe("derniere");
  });

  it("flux : somme par période, série contiguë avec les trous à null", () => {
    const serie = agregerKpiParPeriode(MESURES, { frequence: "mensuelle", nature: "flux" });
    expect(serie.map((s) => s.periode.cle)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(valeurs(serie)).toEqual([15, null, 7]);
    expect(serie.map((s) => s.nombreMesures)).toEqual([2, 0, 1]);
    expect(serie[1]).toMatchObject({ valeurExacte: null });
  });

  it("stock : dernière valeur par date, indépendante de l'ordre de saisie", () => {
    const options = { frequence: "mensuelle", nature: "stock" } as const;
    expect(valeurs(agregerKpiParPeriode(MESURES, options))).toEqual([5, null, 7]);
    const melange = [MESURES[2], MESURES[1], MESURES[0]] as MesureKpi[];
    expect(agregerKpiParPeriode(melange, options)).toEqual(agregerKpiParPeriode(MESURES, options));
  });

  it("moyenne imposée, exacte", () => {
    const serie = agregerKpiParPeriode(
      [
        { date: "2026-01-02", valeur: 1 },
        { date: "2026-01-03", valeur: 1 },
        { date: "2026-01-04", valeur: 2 },
      ],
      { frequence: "trimestrielle", nature: "stock", agregation: "moyenne" },
    );
    expect(serie).toHaveLength(1);
    expect(serie[0]).toMatchObject({ valeur: 1.3333, valeurExacte: "4/3", nombreMesures: 3 });
    expect(
      valeurs(
        agregerKpiParPeriode(MESURES, {
          frequence: "mensuelle",
          nature: "flux",
          agregation: "moyenne",
        }),
      ),
    ).toEqual([7.5, null, 7]);
  });

  it("somme exacte sans bruit flottant", () => {
    const serie = agregerKpiParPeriode(
      [
        { date: "2026-01-01", valeur: 0.1 },
        { date: "2026-01-02", valeur: 0.2 },
      ],
      { frequence: "mensuelle", nature: "flux" },
    );
    expect(serie[0]).toMatchObject({ valeur: 0.3, valeurExacte: "3/10" });
  });

  it("intervalle imposé : périodes vides incluses, mesures hors intervalle écartées", () => {
    const serie = agregerKpiParPeriode(MESURES, {
      frequence: "mensuelle",
      nature: "flux",
      du: "2025-12-01",
      au: "2026-02-28",
    });
    expect(serie.map((s) => s.periode.cle)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(valeurs(serie)).toEqual([null, 15, null]);
  });

  it("sans mesure : série vide, ou entièrement non mesurée sur un intervalle", () => {
    expect(agregerKpiParPeriode([], { frequence: "mensuelle", nature: "flux" })).toEqual([]);
    const vide = agregerKpiParPeriode([], {
      frequence: "trimestrielle",
      nature: "stock",
      du: "2026-01-01",
      au: "2026-12-31",
    });
    expect(valeurs(vide)).toEqual([null, null, null, null]);
  });

  it("refuse deux mesures à la même date pour une dernière valeur", () => {
    const doublon = [...MESURES, { date: "2026-01-20", valeur: 6 }];
    expect(
      codeErreur(() => agregerKpiParPeriode(doublon, { frequence: "mensuelle", nature: "stock" })),
    ).toBe("MESURES_AMBIGUES");
    expect(
      valeurs(agregerKpiParPeriode(doublon, { frequence: "mensuelle", nature: "flux" })),
    ).toEqual([21, null, 7]);
  });

  it("refuse un intervalle incomplet, une date ou une valeur invalide", () => {
    expect(
      codeErreur(() =>
        agregerKpiParPeriode(MESURES, { frequence: "mensuelle", nature: "flux", du: "2026-01-01" }),
      ),
    ).toBe("OPTIONS_INVALIDES");
    expect(
      codeErreur(() =>
        agregerKpiParPeriode([{ date: "2026-13-01", valeur: 1 }], {
          frequence: "mensuelle",
          nature: "flux",
        }),
      ),
    ).toBe("DATE_INVALIDE");
    expect(
      codeErreur(() =>
        agregerKpiParPeriode([{ date: "2026-01-01", valeur: Number.NaN }], {
          frequence: "mensuelle",
          nature: "flux",
        }),
      ),
    ).toBe("NOMBRE_INVALIDE");
  });

  it("agrège en semaines ISO", () => {
    const serie = agregerKpiParPeriode(
      [
        { date: "2026-10-05", valeur: 3 },
        { date: "2026-10-11", valeur: 4 },
        { date: "2026-10-12", valeur: 1 },
      ],
      { frequence: "hebdomadaire", nature: "flux" },
    );
    expect(serie.map((s) => [s.periode.cle, s.valeur])).toEqual([
      ["2026-W41", 7],
      ["2026-W42", 1],
    ]);
  });
});
