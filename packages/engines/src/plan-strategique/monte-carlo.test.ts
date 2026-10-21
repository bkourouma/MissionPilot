import { describe, expect, it, vi } from "vitest";
import {
  calculerPlanFinancier,
  CIBLES_INCERTAINES,
  CLASSES_HISTOGRAMME,
  creerGenerateur,
  ErreurPlan,
  simulerMonteCarlo,
  tirerUniforme,
  TIRAGES_DEFAUT,
  TIRAGES_MAX,
  TIRAGES_MIN,
  validerParametresMonteCarlo,
  type HypothesesPlan,
  type HypotheseIncertaine,
  type ParametresMonteCarlo,
} from "./index";

// Permet de simuler une panne inattendue du modèle dans un seul test.
vi.mock("./modele", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modele")>();
  return { ...original, calculerDepuisNormalisees: vi.fn(original.calculerDepuisNormalisees) };
});

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

const hypotheses: HypotheseIncertaine[] = [
  {
    cible: "croissanceChiffreAffaires",
    loi: { type: "normale", moyenne: 0, ecartType: 3, min: -10, max: 10 },
  },
  { cible: "tauxMargeBrute", loi: { type: "triangulaire", min: -5, mode: 0, max: 4 } },
  { cible: "chargesFixes", loi: { type: "uniforme", min: -10, max: 20 } },
  { cible: "delaiClientsJours", loi: { type: "uniforme", min: 0, max: 30 } },
];

const parametres: ParametresMonteCarlo = { graine: 7, tirages: TIRAGES_MAX, hypotheses };

function erreurDe(f: () => unknown): ErreurPlan | null {
  try {
    f();
  } catch (e) {
    return e as ErreurPlan;
  }
  return null;
}

describe("constantes", () => {
  it("fixent les bornes de tirages", () => {
    expect([TIRAGES_MIN, TIRAGES_DEFAUT, TIRAGES_MAX]).toEqual([100, 1000, 2000]);
    expect(CIBLES_INCERTAINES).toHaveLength(5);
  });
});

describe("simulerMonteCarlo : reproductibilité", () => {
  const r = simulerMonteCarlo(h, parametres);

  it("deux exécutions à graine égale donnent exactement le même résultat", () => {
    expect(simulerMonteCarlo(h, parametres)).toEqual(r);
    expect(JSON.stringify(simulerMonteCarlo(h, parametres))).toBe(JSON.stringify(r));
  });

  it("des graines différentes donnent des résultats différents", () => {
    const autre = simulerMonteCarlo(h, { ...parametres, graine: 8 });
    expect(autre.empreinte).not.toBe(r.empreinte);
    expect(autre.van.percentiles.p50).not.toBe(r.van.percentiles.p50);
  });

  it("l'ordre de saisie des hypothèses ne change pas le résultat", () => {
    const inverse = simulerMonteCarlo(h, { ...parametres, hypotheses: [...hypotheses].reverse() });
    expect(inverse).toEqual(r);
  });

  it("valeurs d'or : empreinte et VAN médiane d'un cas figé", () => {
    expect(r.empreinte).toBe("e5d59455");
    expect(r.van.percentiles.p50).toBe(41_776_139);
    expect(r.van.moyenne).toBe(41_836_582);
    expect(r.base).toEqual({ van: 48_324_101, tresorerieMinimale: 17_208_333 });
  });

  it("décrit la simulation et ses statistiques de façon cohérente", () => {
    expect(r.moteur).toBe("engines/plan-strategique/monte-carlo@1");
    expect(r.graine).toBe(7);
    expect(r.tirages).toBe(2000);
    expect(r.tiragesValides + r.tiragesRejetes).toBe(2000);
    const { percentiles: p, histogramme, minimum, maximum } = r.van;
    const rangs = [p.p5, p.p10, p.p25, p.p50, p.p75, p.p90, p.p95];
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    expect(minimum).toBeLessThanOrEqual(p.p5);
    expect(p.p95).toBeLessThanOrEqual(maximum);
    expect(histogramme.effectifs).toHaveLength(CLASSES_HISTOGRAMME);
    expect(histogramme.bornes).toHaveLength(CLASSES_HISTOGRAMME + 1);
    expect(histogramme.bornes[0]).toBe(minimum);
    expect(histogramme.bornes[CLASSES_HISTOGRAMME]).toBe(maximum);
    expect(histogramme.effectifs.reduce((a, b) => a + b, 0)).toBe(r.tiragesValides);
    expect(r.probabiliteTensionParAnnee).toHaveLength(3);
    expect(r.empreinte).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(r)).not.toMatch(/NaN|null/);
  });
});

describe("simulerMonteCarlo : cas analytique (plan déficitaire sans impôt)", () => {
  // CA 100 M à 30 % de marge = 30 M ; charges fixes 40 M × (1 + d/100) ; croissance nulle.
  // Aucun résultat positif : pas d'IS, pas de dividendes. Trésorerie de clôture de
  // l'année t = 33 M − t × (10 M + 0,4 M × d) : linéaire en d, décroissante.
  const deficitaire: HypothesesPlan = {
    premierExercice: 2027,
    horizon: 3,
    chiffreAffairesReference: 100_000_000,
    croissanceChiffreAffaires: 0,
    tauxMargeBrute: 30,
    chargesFixes: 40_000_000,
    bilanOuverture: { tresorerie: 33_000_000, capital: 33_000_000 },
  };
  const A = -10;
  const B = 10;
  const avecEcart = (d: number): HypothesesPlan => ({
    ...deficitaire,
    chargesFixes: Math.round(40_000_000 * (1 + d / 100)),
  });
  const tresorerieFinale = (d: number) =>
    calculerPlanFinancier(avecEcart(d)).synthese.tresorerieFinale;
  const van = (d: number) => calculerPlanFinancier(avecEcart(d)).synthese.valeurActuelleNette;

  it("la probabilité de tension vaut (b − d*) / (b − a) à ±0,05 ; la VAN moyenne suit la linéarité", () => {
    const t1 = tresorerieFinale(A);
    const t2 = tresorerieFinale(B);
    // Valeur d* qui annule la trésorerie, par interpolation de deux évaluations du moteur.
    const dEtoile = A + ((0 - t1) * (B - A)) / (t2 - t1);
    expect(dEtoile).toBeCloseTo(2.5, 6);
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBeLessThan(0);

    const r = simulerMonteCarlo(deficitaire, {
      graine: 2026,
      tirages: 2000,
      hypotheses: [{ cible: "chargesFixes", loi: { type: "uniforme", min: A, max: B } }],
    });
    expect(r.tiragesRejetes).toBe(0);
    const theorique = (B - dEtoile) / (B - A);
    expect(Math.abs(r.probabiliteTension - theorique)).toBeLessThan(0.05);
    // Trésorerie décroissante : la tension de l'année 3 est celle de l'horizon.
    expect(r.probabiliteTensionParAnnee[2]).toBe(r.probabiliteTension);
    expect(r.probabiliteTensionParAnnee[0]).toBeLessThanOrEqual(r.probabiliteTensionParAnnee[1]!);
    expect(r.probabiliteVanNegative).toBe(1);

    // VAN affine en d : sa moyenne est celle de la VAN en d = (a + b) / 2. Écart-type de la
    // moyenne empirique ≈ 0,5 % de |VAN| (pente × 5,77 / √2000) : tolérance relative 2 % (≈ 4 σ).
    const vanMilieu = van((A + B) / 2);
    expect(Math.abs(r.van.moyenne - vanMilieu) / Math.abs(vanMilieu)).toBeLessThan(0.02);
    expect(r.base.van).toBe(van(0));
    expect(r.base.tresorerieMinimale).toBe(tresorerieFinale(0));
  });
});

describe("simulerMonteCarlo : tirages rejetés", () => {
  const baseSansDelai: HypothesesPlan = { ...h, delaiClientsJours: 0 };
  // Délai clients de base 0 ; écart uniforme(−5, 45) : environ 10 % de valeurs négatives rejetées.
  const delai = {
    cible: "delaiClientsJours",
    loi: { type: "uniforme", min: -5, max: 45 },
  } as const;

  it("compte les tirages hors bornes, sans les inclure dans les statistiques", () => {
    const r = simulerMonteCarlo(baseSansDelai, { graine: 3, tirages: 1000, hypotheses: [delai] });
    expect(r.tiragesRejetes).toBeGreaterThan(50);
    expect(r.tiragesRejetes).toBeLessThan(150);
    expect(r.tiragesValides).toBe(1000 - r.tiragesRejetes);
    expect(r.van.histogramme.effectifs.reduce((a, b) => a + b, 0)).toBe(r.tiragesValides);
  });

  it("un tirage rejeté ne décale pas le flux : les valides sont ceux du flux brut de la graine", () => {
    const g = creerGenerateur(3);
    const attendues: number[] = [];
    let rejetes = 0;
    for (let t = 0; t < 500; t++) {
      const ecart = Math.round(tirerUniforme(g, -5, 45) * 100) / 100;
      if (ecart < 0) {
        rejetes++;
        continue;
      }
      const r = calculerPlanFinancier({ ...baseSansDelai, delaiClientsJours: ecart });
      attendues.push(r.synthese.valeurActuelleNette);
    }
    const r = simulerMonteCarlo(baseSansDelai, { graine: 3, tirages: 500, hypotheses: [delai] });
    expect(r.tiragesRejetes).toBe(rejetes);
    expect(r.van.minimum).toBe(Math.min(...attendues));
    expect(r.van.maximum).toBe(Math.max(...attendues));
  });

  it("refuse la simulation si plus de 20 % des tirages sont rejetés", () => {
    const e = erreurDe(() =>
      simulerMonteCarlo(baseSansDelai, {
        graine: 3,
        tirages: 1000,
        hypotheses: [{ cible: "delaiClientsJours", loi: { type: "uniforme", min: -30, max: 30 } }],
      }),
    );
    expect(e?.code).toBe("MONTE_CARLO_INVALIDE");
    expect(e?.message).toContain("20 %");
  });

  it("refuse la simulation si aucun tirage n'est valide (charges fixes ≤ −100 %)", () => {
    const e = erreurDe(() =>
      simulerMonteCarlo(h, {
        graine: 3,
        tirages: 100,
        hypotheses: [{ cible: "chargesFixes", loi: { type: "uniforme", min: -200, max: -150 } }],
      }),
    );
    expect(e?.code).toBe("MONTE_CARLO_INVALIDE");
  });

  it("propage les erreurs inattendues du modèle", async () => {
    const modele = await import("./modele");
    const mock = vi.mocked(modele.calculerDepuisNormalisees);
    const reel = mock.getMockImplementation()!;
    // 1er appel : scénario de référence ; 2e : premier tirage.
    mock.mockImplementationOnce(reel);
    mock.mockImplementationOnce(() => {
      throw new ErreurPlan("FLUX_INVALIDES", "panne");
    });
    expect(erreurDe(() => simulerMonteCarlo(h, parametres))?.code).toBe("FLUX_INVALIDES");
    mock.mockImplementationOnce(reel);
    mock.mockImplementationOnce(() => {
      throw new Error("autre");
    });
    expect(() => simulerMonteCarlo(h, parametres)).toThrow("autre");
  });
});

describe("simulerMonteCarlo : entrées", () => {
  it("laisse remonter l'erreur d'hypothèses de plan invalides", () => {
    const e = erreurDe(() => simulerMonteCarlo({ ...h, horizon: 9 }, parametres));
    expect(e?.code).toBe("HORIZON_INVALIDE");
  });

  it("gère le cas dégénéré où toutes les VAN sont égales (histogramme et écart-type)", () => {
    // Chiffre d'affaires de référence nul : le taux de marge n'a aucun effet, la VAN est constante.
    const r = simulerMonteCarlo(
      { ...h, chiffreAffairesReference: 0 },
      {
        graine: 1,
        tirages: 100,
        hypotheses: [{ cible: "tauxMargeBrute", loi: { type: "uniforme", min: -5, max: 5 } }],
      },
    );
    expect(r.tiragesRejetes).toBeLessThanOrEqual(20);
    expect(r.van.minimum).toBe(r.van.maximum);
    expect(r.van.ecartType).toBe(0);
    expect(r.van.histogramme.effectifs[0]).toBe(r.tiragesValides);
    expect(r.van.histogramme.effectifs.slice(1).every((x) => x === 0)).toBe(true);
    expect(new Set(r.van.histogramme.bornes).size).toBe(1);
  });
});

describe("validerParametresMonteCarlo", () => {
  const ok = (p: Partial<ParametresMonteCarlo> = {}): ParametresMonteCarlo => ({
    graine: 1,
    tirages: 500,
    hypotheses: [{ cible: "chargesFixes", loi: { type: "uniforme", min: -1, max: 1 } }],
    ...p,
  });
  const refus = (p: unknown, chemin: string) => {
    const e = erreurDe(() => validerParametresMonteCarlo(p as ParametresMonteCarlo));
    expect(e?.code).toBe("MONTE_CARLO_INVALIDE");
    expect(e?.chemin).toBe(chemin);
  };
  const unique = (loi: unknown, cible = "tauxMargeBrute") =>
    ok({ hypotheses: [{ cible, loi } as unknown as HypotheseIncertaine] });
  const valide = (p: ParametresMonteCarlo) =>
    expect(erreurDe(() => validerParametresMonteCarlo(p))).toBeNull();

  it("accepte les paramètres valides, bornes de tirages comprises", () => {
    valide(ok());
    valide(ok({ tirages: TIRAGES_MIN }));
    valide(ok({ tirages: TIRAGES_MAX }));
    valide(parametres);
  });

  it("refuse les tirages hors de 100 à 2000 (plafonds)", () => {
    for (const tirages of [99, 2001, 150.5, Number.NaN]) refus(ok({ tirages }), "tirages");
    expect(erreurDe(() => simulerMonteCarlo(h, ok({ tirages: 2001 })))?.code).toBe(
      "MONTE_CARLO_INVALIDE",
    );
    expect(erreurDe(() => simulerMonteCarlo(h, ok({ tirages: 99 })))?.code).toBe(
      "MONTE_CARLO_INVALIDE",
    );
  });

  it("refuse une graine invalide", () => {
    refus(ok({ graine: -1 }), "graine");
    refus(ok({ graine: 2 ** 32 }), "graine");
    refus(ok({ graine: 1.5 }), "graine");
  });

  it("refuse 0 hypothèse, plus de 5, une saisie non tableau", () => {
    refus(ok({ hypotheses: [] }), "hypotheses");
    refus(ok({ hypotheses: undefined as never }), "hypotheses");
    const six = [...CIBLES_INCERTAINES, "chargesFixes"].map((cible) => ({
      cible,
      loi: { type: "uniforme", min: 0, max: 1 },
    }));
    refus(ok({ hypotheses: six as never }), "hypotheses");
  });

  it("refuse une cible inconnue, en double, ou une hypothèse non objet", () => {
    refus(unique({ type: "uniforme", min: 0, max: 1 }, "stocksJours"), "hypotheses[0].cible");
    refus(ok({ hypotheses: [null as never] }), "hypotheses[0]");
    const e = erreurDe(() =>
      validerParametresMonteCarlo(
        ok({
          hypotheses: [
            { cible: "chargesFixes", loi: { type: "uniforme", min: 0, max: 1 } },
            { cible: "tauxMargeBrute", loi: { type: "uniforme", min: 0, max: 1 } },
            { cible: "chargesFixes", loi: { type: "uniforme", min: 0, max: 1 } },
          ],
        }),
      ),
    );
    expect(e?.chemin).toBe("hypotheses[2].cible");
    expect(e?.message).toContain("en double");
  });

  it("refuse les lois invalides avec le chemin précis", () => {
    refus(unique(undefined), "hypotheses[0].loi");
    refus(unique({ type: "gamma" }), "hypotheses[0].loi.type");
    // uniforme
    refus(unique({ type: "uniforme", min: 1, max: 1 }), "hypotheses[0].loi.max");
    refus(unique({ type: "uniforme", min: 2, max: 1 }), "hypotheses[0].loi.max");
    refus(unique({ type: "uniforme", min: 0, max: Infinity }), "hypotheses[0].loi.max");
    refus(unique({ type: "uniforme", min: Number.NaN, max: 1 }), "hypotheses[0].loi.min");
    refus(unique({ type: "uniforme", min: "0", max: 1 }), "hypotheses[0].loi.min");
    refus(unique({ type: "uniforme", min: -5000, max: 1 }), "hypotheses[0].loi.min");
    // triangulaire
    refus(unique({ type: "triangulaire", min: 0, mode: 2, max: 1 }), "hypotheses[0].loi.mode");
    refus(unique({ type: "triangulaire", min: 0, mode: -1, max: 1 }), "hypotheses[0].loi.mode");
    refus(unique({ type: "triangulaire", min: 1, mode: 1, max: 1 }), "hypotheses[0].loi.max");
    refus(unique({ type: "triangulaire", min: 0, max: 1 }), "hypotheses[0].loi.mode");
    valide(unique({ type: "triangulaire", min: 0, mode: 1, max: 1 }));
    // normale
    const n = { type: "normale", moyenne: 0, ecartType: 1, min: -3, max: 3 };
    valide(unique(n));
    refus(unique({ ...n, ecartType: 0 }), "hypotheses[0].loi.ecartType");
    refus(unique({ ...n, ecartType: -1 }), "hypotheses[0].loi.ecartType");
    refus(unique({ ...n, ecartType: Infinity }), "hypotheses[0].loi.ecartType");
    refus(unique({ ...n, min: 3 }), "hypotheses[0].loi.max");
    refus(unique({ ...n, moyenne: 5 }), "hypotheses[0].loi.moyenne");
    refus(unique({ ...n, moyenne: -5 }), "hypotheses[0].loi.moyenne");
    refus(unique({ ...n, moyenne: Number.NaN }), "hypotheses[0].loi.moyenne");
  });

  it("indique l'indice de l'hypothèse fautive", () => {
    refus(
      ok({
        hypotheses: [
          { cible: "chargesFixes", loi: { type: "uniforme", min: 0, max: 1 } },
          { cible: "tauxMargeBrute", loi: { type: "uniforme", min: 0, max: -1 } },
        ],
      }),
      "hypotheses[1].loi.max",
    );
  });
});

describe("simulerMonteCarlo : statistiques", () => {
  it("couvre la loi normale sur une charge variable, sans NaN", () => {
    const r = simulerMonteCarlo(h, {
      graine: 99,
      tirages: 100,
      hypotheses: [
        {
          cible: "tauxChargesVariables",
          loi: { type: "normale", moyenne: 0, ecartType: 1, min: -2, max: 2 },
        },
      ],
    });
    expect(r.tiragesRejetes).toBeLessThanOrEqual(20);
    for (const v of Object.values(r.van.percentiles)) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isInteger(r.van.moyenne)).toBe(true);
    expect(Number.isInteger(r.van.ecartType)).toBe(true);
    expect(r.probabiliteTension).toBe(0);
    expect(r.probabiliteVanNegative).toBe(0);
  });

  it("probabilités arrondies à 4 décimales (multiples de 0,0001)", () => {
    const r = simulerMonteCarlo(
      { ...h, chargesFixes: 40_000_000, tauxMargeBrute: 30, croissanceChiffreAffaires: 0 },
      {
        graine: 5,
        tirages: 300,
        hypotheses: [{ cible: "chargesFixes", loi: { type: "uniforme", min: -10, max: 10 } }],
      },
    );
    for (const p of [r.probabiliteTension, r.probabiliteVanNegative]) {
      expect(Math.abs(p * 10_000 - Math.round(p * 10_000))).toBeLessThan(1e-6);
    }
  });
});
