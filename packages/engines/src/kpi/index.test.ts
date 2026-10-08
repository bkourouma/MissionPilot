import { describe, expect, it } from "vitest";
import * as kpi from "./index";

describe("API publique du domaine KPI", () => {
  it("expose les moteurs de chaque module", () => {
    const attendues = [
      "ErreurKpi",
      "SEUILS_STATUT_KPI_DEFAUT",
      "tauxAtteinteKpi",
      "statutKpiDepuisTaux",
      "rangStatutKpi",
      "ecartCibleKpi",
      "evaluerKpi",
      "periodeKpiDe",
      "periodesKpiEntre",
      "agregerKpiParPeriode",
      "tendanceKpi",
      "projeterKpiFinPeriode",
      "scoreCompositeKpi",
      "alerteDegradationKpi",
      "alerteRetardKpi",
      "alertesSeuilsKpi",
    ];
    attendues.forEach((nom) => expect(kpi).toHaveProperty(nom));
  });

  it("enchaîne agrégation, évaluation, tendance et alerte sur un même KPI", () => {
    // Chiffre d'affaires mensuel (flux, plus haut = mieux), cible 1 000 000 par mois.
    const mesures = [
      { date: "2026-01-12", valeur: 600_000 },
      { date: "2026-01-28", valeur: 450_000 },
      { date: "2026-02-15", valeur: 980_000 },
      { date: "2026-03-20", valeur: 900_000 },
      { date: "2026-04-18", valeur: 790_000 },
    ];
    const serie = kpi.agregerKpiParPeriode(mesures, { frequence: "mensuelle", nature: "flux" });
    const valeurs = serie.map((s) => s.valeur);
    expect(valeurs).toEqual([1_050_000, 980_000, 900_000, 790_000]);
    const statuts = valeurs.map(
      (valeur) => kpi.evaluerKpi({ valeur, cible: 1_000_000, sens: "plus_haut_mieux" }).statut,
    );
    expect(statuts).toEqual(["vert", "vert", "orange", "rouge"]);
    expect(kpi.tendanceKpi(valeurs, "plus_haut_mieux").evolution).toBe("degradation");
    expect(kpi.alerteDegradationKpi(valeurs, "plus_haut_mieux")).toMatchObject({ periodes: 3 });
    expect(
      kpi.alerteRetardKpi({
        frequence: "mensuelle",
        datesMesures: mesures.map((m) => m.date),
        dateReference: "2026-06-10",
      }),
    ).toMatchObject({ periodeAttendue: "2026-05", periodesManquantes: 1 });
  });
});
