import { describe, expect, it } from "vitest";
import {
  calculerPlanFinancier,
  calculerScenariosPlan,
  ECARTS_SCENARIOS_DEFAUT,
  ErreurPlan,
  normaliserHypotheses,
  type HypothesesPlan,
} from "./index";
import { appliquerEcarts } from "./scenarios";

const h: HypothesesPlan = {
  premierExercice: 2027,
  horizon: 3,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  delaiClientsJours: 30,
  bilanOuverture: { tresorerie: 5_000_000, capital: 5_000_000 },
};

function erreurDe(f: () => unknown): ErreurPlan | null {
  try {
    f();
  } catch (e) {
    return e as ErreurPlan;
  }
  return null;
}

describe("calculerScenariosPlan", () => {
  const s = calculerScenariosPlan(h);

  it("le scénario de base est le calcul direct des hypothèses", () => {
    expect(s.base).toEqual(calculerPlanFinancier(h));
    expect(s.ecarts).toBe(ECARTS_SCENARIOS_DEFAUT);
  });

  it("applique les écarts par défaut (croissance ±5 pts, marge ±2 pts, fixes ∓5 %)", () => {
    expect(s.optimiste.hypotheses.croissanceChiffreAffaires).toEqual([15, 15, 15]);
    expect(s.optimiste.hypotheses.tauxMargeBrute).toEqual([42, 42, 42]);
    expect(s.optimiste.hypotheses.chargesFixes).toEqual([9_500_000, 9_500_000, 9_500_000]);
    expect(s.optimiste.hypotheses.delaiClientsJours).toEqual([30, 30, 30]);
    expect(s.pessimiste.hypotheses.croissanceChiffreAffaires).toEqual([5, 5, 5]);
    expect(s.pessimiste.hypotheses.tauxMargeBrute).toEqual([38, 38, 38]);
    expect(s.pessimiste.hypotheses.chargesFixes).toEqual([10_500_000, 10_500_000, 10_500_000]);
    expect(s.pessimiste.hypotheses.delaiClientsJours).toEqual([45, 45, 45]);
    // CA de l'année 3 : 100 M × 1,1³, × 1,15³, × 1,05³.
    expect(s.synthese.map((x) => x.chiffreAffairesFinal)).toEqual([
      133_100_000, 152_087_500, 115_762_500,
    ]);
  });

  it("ordonne les résultats : optimiste ≥ base ≥ pessimiste", () => {
    const [base, opt, pes] = s.synthese;
    expect(s.synthese.map((x) => x.scenario)).toEqual(["base", "optimiste", "pessimiste"]);
    expect(opt!.resultatNetCumule).toBeGreaterThan(base!.resultatNetCumule);
    expect(base!.resultatNetCumule).toBeGreaterThan(pes!.resultatNetCumule);
    expect(opt!.tresorerieFinale).toBeGreaterThan(base!.tresorerieFinale);
    expect(base!.tresorerieFinale).toBeGreaterThan(pes!.tresorerieFinale);
    expect(opt!.valeurActuelleNette).toBeGreaterThan(pes!.valeurActuelleNette);
    expect(s.base.equilibre && s.optimiste.equilibre && s.pessimiste.equilibre).toBe(true);
    expect(base!.nombreAlertes).toBe(0);
  });

  it("accepte des écarts propres et additionne en décimal exact", () => {
    const r = calculerScenariosPlan(
      { ...h, croissanceChiffreAffaires: 10.1, tauxChargesVariables: 0.1 },
      {
        optimiste: { croissanceChiffreAffaires: 0.2, tauxChargesVariables: 0.2 },
        pessimiste: {},
      },
    );
    expect(r.optimiste.hypotheses.croissanceChiffreAffaires).toEqual([10.3, 10.3, 10.3]);
    expect(r.optimiste.hypotheses.tauxChargesVariables).toEqual([0.3, 0.3, 0.3]);
    expect(r.pessimiste.annees).toEqual(r.base.annees);
  });

  it("refuse une hypothèse sortie de ses bornes après écart, sans la plafonner", () => {
    const e = erreurDe(() => calculerScenariosPlan({ ...h, tauxMargeBrute: 99 }));
    expect(e?.code).toBe("HYPOTHESE_INVALIDE");
    expect(e?.chemin).toBe("tauxMargeBrute[0]");
    expect(e?.message).toMatch(/^Scénario optimiste : /);
    const f = erreurDe(() => calculerScenariosPlan({ ...h, croissanceChiffreAffaires: -97 }));
    expect(f?.message).toMatch(/^Scénario pessimiste : /);
  });

  it("refuse un écart invalide", () => {
    const n = normaliserHypotheses(h);
    expect(erreurDe(() => appliquerEcarts(n, { chargesFixes: -100 }, "pessimiste"))?.chemin).toBe(
      "ecarts.pessimiste.chargesFixes",
    );
    expect(
      erreurDe(() => appliquerEcarts(n, { tauxMargeBrute: Number.NaN }, "optimiste"))?.code,
    ).toBe("HYPOTHESE_INVALIDE");
    expect(appliquerEcarts(n, {}, "neutre")).toEqual(n);
  });

  it("propage les refus des hypothèses de base", () => {
    expect(erreurDe(() => calculerScenariosPlan({ ...h, horizon: 6 }))?.code).toBe(
      "HORIZON_INVALIDE",
    );
  });
});
