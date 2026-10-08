import { describe, expect, it } from "vitest";
import {
  calculerScenariosPlan,
  comparerResultatsPlan,
  ecartValeurs,
  ErreurPlan,
  SERIES_CLES_PLAN,
  type HypothesesPlan,
  type ResultatScenarios,
} from "./index";

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

describe("ecartValeurs", () => {
  it("écart exact et relatif à la valeur de départ", () => {
    expect(ecartValeurs(200, 250)).toEqual({ de: 200, a: 250, ecart: 50, ecartRelatif: 0.25 });
    expect(ecartValeurs(-200, -250)).toEqual({
      de: -200,
      a: -250,
      ecart: -50,
      ecartRelatif: -0.25,
    });
    expect(ecartValeurs(3, 4).ecartRelatif).toBe(0.3333);
  });

  it("valeur de départ nulle : pas d'écart relatif", () => {
    expect(ecartValeurs(0, 10)).toEqual({ de: 0, a: 10, ecart: 10, ecartRelatif: null });
  });

  it("valeur absente : ni écart ni écart relatif", () => {
    expect(ecartValeurs(null, 10)).toEqual({ de: null, a: 10, ecart: null, ecartRelatif: null });
    expect(ecartValeurs(10, null).ecart).toBeNull();
  });

  it("décimaux exacts et taux sans écart relatif", () => {
    expect(ecartValeurs(0.1, 0.3, "taux")).toEqual({
      de: 0.1,
      a: 0.3,
      ecart: 0.2,
      ecartRelatif: null,
    });
    expect(ecartValeurs(0.1, 0.3, "nombre").ecartRelatif).toBe(2);
  });

  it("refuse un écart hors des entiers sûrs", () => {
    expect(() => ecartValeurs(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(
      ErreurPlan,
    );
  });
});

describe("comparerResultatsPlan", () => {
  const v1 = calculerScenariosPlan(h);
  const v2 = calculerScenariosPlan({ ...h, croissanceChiffreAffaires: 12 });

  it("compare chaque série clé, exercice par exercice", () => {
    const c = comparerResultatsPlan(v1, v2);
    expect(c.series.map((s) => s.cle)).toEqual(SERIES_CLES_PLAN.map((s) => s.cle));
    const ca = c.series.find((s) => s.cle === "chiffre_affaires")!;
    expect(ca.points.map((p) => p.exercice)).toEqual([2027, 2028, 2029]);
    const p1 = ca.points[0]!;
    expect(p1.de).toBe(v1.base.annees[0]!.compteResultat.chiffreAffaires);
    expect(p1.a).toBe(v2.base.annees[0]!.compteResultat.chiffreAffaires);
    // 112 M − 110 M = 2 M ; 2 / 110 = 0,0182.
    expect(p1.ecart).toBe(2_000_000);
    expect(p1.ecartRelatif).toBe(0.0182);
  });

  it("deux versions identiques : écarts nuls", () => {
    const c = comparerResultatsPlan(v1, v1);
    for (const s of c.series) for (const p of s.points) expect(p.ecart).toBe(0);
    for (const s of c.synthese) {
      for (const i of s.indicateurs) if (i.de !== null) expect(i.ecart).toBe(0);
    }
  });

  it("synthèse des trois scénarios, taux en écart de points", () => {
    const c = comparerResultatsPlan(v1, v2);
    expect(c.synthese.map((s) => s.scenario)).toEqual(["base", "optimiste", "pessimiste"]);
    const base = c.synthese[0]!;
    const ca = base.indicateurs.find((i) => i.cle === "chiffre_affaires_final")!;
    expect(ca.nature).toBe("montant");
    expect(ca.ecart).toBe(
      v2.synthese[0]!.chiffreAffairesFinal - v1.synthese[0]!.chiffreAffairesFinal,
    );
    const tri = base.indicateurs.find((i) => i.cle === "taux_rendement_interne")!;
    expect(tri.nature).toBe("taux");
    expect(tri.ecartRelatif).toBeNull();
    expect(base.indicateurs.find((i) => i.cle === "nombre_alertes")!.nature).toBe("nombre");
  });

  it("aligne les exercices par millésime (premier exercice différent)", () => {
    const decale = calculerScenariosPlan({ ...h, premierExercice: 2028 });
    const ca = comparerResultatsPlan(v1, decale).series[0]!;
    expect(ca.points.map((p) => p.exercice)).toEqual([2027, 2028, 2029, 2030]);
    expect(ca.points[0]).toMatchObject({ a: null, ecart: null });
    expect(ca.points[3]).toMatchObject({ de: null, ecart: null });
  });

  it("scénario absent d'un résultat : valeurs nulles", () => {
    const sansSynthese = { ...v2, synthese: [] } as unknown as ResultatScenarios;
    const c = comparerResultatsPlan(v1, sansSynthese);
    expect(c.synthese[0]!.indicateurs.every((i) => i.a === null && i.ecart === null)).toBe(true);
    const c2 = comparerResultatsPlan(sansSynthese, v1);
    expect(c2.synthese[0]!.indicateurs.every((i) => i.de === null)).toBe(true);
  });

  it("chaque série extrait la valeur attendue", () => {
    const a = v1.base.annees[0]!;
    const attendu: Record<string, number> = {
      chiffre_affaires: a.compteResultat.chiffreAffaires,
      excedent_brut_exploitation: a.compteResultat.excedentBrutExploitation,
      resultat_net: a.compteResultat.resultatNet,
      capacite_autofinancement: a.indicateurs.capaciteAutofinancement,
      tresorerie_nette: a.bilan.tresorerieNette,
      flux_libre: a.indicateurs.fluxLibre,
      endettement_net: a.indicateurs.endettementNet,
    };
    for (const s of SERIES_CLES_PLAN) expect(s.extraire(a)).toBe(attendu[s.cle]);
  });
});
