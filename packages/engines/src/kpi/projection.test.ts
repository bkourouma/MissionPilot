import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import { projeterKpiFinPeriode } from "./projection";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

const OCTOBRE = { debut: "2026-10-01", fin: "2026-10-31" } as const;

describe("projection à la fin de période", () => {
  it("flux : prorata du cumul, mesures hors fenêtre écartées", () => {
    const projection = projeterKpiFinPeriode(
      [
        { date: "2026-09-30", valeur: 50 },
        { date: "2026-10-01", valeur: 100 },
        { date: "2026-10-05", valeur: 200 },
        { date: "2026-10-12", valeur: 999 },
      ],
      { nature: "flux", ...OCTOBRE, dateReference: "2026-10-10" },
    );
    expect(projection).toEqual({
      valeurProjetee: 930,
      valeurExacte: "930",
      methode: "prorata",
      joursEcoules: 10,
      joursTotal: 31,
    });
  });

  it("flux : arrondi à 4 décimales, exact conservé", () => {
    const projection = projeterKpiFinPeriode([{ date: "2026-10-02", valeur: 100 }], {
      nature: "flux",
      ...OCTOBRE,
      dateReference: "2026-10-03",
    });
    expect(projection).toMatchObject({ valeurProjetee: 1033.3333, valeurExacte: "3100/3" });
  });

  it("après la fin de période, la projection vaut le réalisé", () => {
    const projection = projeterKpiFinPeriode([{ date: "2026-10-20", valeur: 40 }], {
      nature: "flux",
      ...OCTOBRE,
      dateReference: "2026-11-15",
    });
    expect(projection).toMatchObject({ valeurProjetee: 40, joursEcoules: 31, joursTotal: 31 });
  });

  it("stock : droite des moindres carrés évaluée au dernier jour", () => {
    const mesures = [
      { date: "2026-10-01", valeur: 100 },
      { date: "2026-10-11", valeur: 120 },
    ];
    const options = { nature: "stock", ...OCTOBRE, dateReference: "2026-10-15" } as const;
    expect(projeterKpiFinPeriode(mesures, options)).toMatchObject({
      valeurProjetee: 160,
      methode: "regression",
    });
    // Un historique antérieur aligné ne change pas la droite.
    const historique = [{ date: "2026-09-21", valeur: 80 }, ...mesures];
    expect(projeterKpiFinPeriode(historique, options).valeurProjetee).toBe(160);
    // Une mesure postérieure à la date de référence est ignorée.
    const futur = [...mesures, { date: "2026-10-20", valeur: 0 }];
    expect(projeterKpiFinPeriode(futur, options).valeurProjetee).toBe(160);
  });

  it("stock : une seule date mesurée, valeur reconduite", () => {
    const options = { nature: "stock", ...OCTOBRE, dateReference: "2026-10-15" } as const;
    expect(projeterKpiFinPeriode([{ date: "2026-10-03", valeur: 42 }], options)).toMatchObject({
      valeurProjetee: 42,
      methode: "reconduction",
    });
    const memeJour = [
      { date: "2026-10-03", valeur: 100 },
      { date: "2026-10-03", valeur: 110 },
    ];
    expect(projeterKpiFinPeriode(memeJour, options).valeurProjetee).toBe(105);
  });

  it("aucune mesure exploitable : pas de projection", () => {
    for (const nature of ["flux", "stock"] as const) {
      expect(
        projeterKpiFinPeriode([{ date: "2026-10-20", valeur: 1 }], {
          nature,
          ...OCTOBRE,
          dateReference: "2026-10-10",
        }),
      ).toEqual({
        valeurProjetee: null,
        valeurExacte: null,
        methode: "aucune",
        joursEcoules: 10,
        joursTotal: 31,
      });
    }
  });

  it("refuse une période inversée ou une référence antérieure au début", () => {
    expect(
      codeErreur(() =>
        projeterKpiFinPeriode([], {
          nature: "flux",
          debut: "2026-10-31",
          fin: "2026-10-01",
          dateReference: "2026-10-31",
        }),
      ),
    ).toBe("PERIODE_INVALIDE");
    expect(
      codeErreur(() =>
        projeterKpiFinPeriode([], { nature: "flux", ...OCTOBRE, dateReference: "2026-09-30" }),
      ),
    ).toBe("PERIODE_INVALIDE");
    expect(
      codeErreur(() =>
        projeterKpiFinPeriode([{ date: "2026-10-01", valeur: Number.NaN }], {
          nature: "flux",
          ...OCTOBRE,
          dateReference: "2026-10-05",
        }),
      ),
    ).toBe("NOMBRE_INVALIDE");
  });
});
