import { describe, expect, it } from "vitest";
import {
  ErreurPlan,
  HORIZON_PLAN_DEFAUT,
  normaliserHypotheses,
  validerHorizon,
  type HypothesesPlan,
} from "./index";

const minimal: HypothesesPlan = {
  premierExercice: 2027,
  chiffreAffairesReference: 50_000_000,
  croissanceChiffreAffaires: 8,
  tauxMargeBrute: 35,
};

function erreurDe(h: HypothesesPlan): { code: string; chemin: string } | null {
  try {
    normaliserHypotheses(h);
  } catch (e) {
    if (e instanceof ErreurPlan) return { code: e.code, chemin: e.chemin };
    throw e;
  }
  return null;
}

describe("validerHorizon", () => {
  it("5 ans par défaut, de 3 à 5 ans", () => {
    expect(validerHorizon(undefined)).toBe(HORIZON_PLAN_DEFAUT);
    expect(validerHorizon(3)).toBe(3);
    expect(validerHorizon(4)).toBe(4);
    expect(validerHorizon(5)).toBe(5);
  });

  it.each([2, 6, 0, -5, 3.5, Number.NaN])("refuse l'horizon %s", (h) => {
    expect(() => validerHorizon(h)).toThrow(ErreurPlan);
    expect(erreurDe({ ...minimal, horizon: h })).toEqual({
      code: "HORIZON_INVALIDE",
      chemin: "horizon",
    });
  });
});

describe("normaliserHypotheses", () => {
  it("complète les valeurs par défaut", () => {
    const n = normaliserHypotheses(minimal);
    expect(n.devise).toBe("XOF");
    expect(n.horizon).toBe(5);
    expect(n.croissanceChiffreAffaires).toEqual([8, 8, 8, 8, 8]);
    expect(n.tauxChargesVariables).toEqual([0, 0, 0, 0, 0]);
    expect(n.chargesFixes).toEqual([0, 0, 0, 0, 0]);
    expect(n.tauxImpotSocietes).toBe(25);
    expect(n.tauxActualisation).toBe(12);
    expect(n.tauxDistributionDividendes).toBe(0);
    expect(n.bilanOuverture.tresorerie).toBe(0);
    expect(n.effectifs).toEqual([]);
  });

  it("accepte une valeur par année et une autre devise", () => {
    const n = normaliserHypotheses({
      ...minimal,
      devise: "EUR",
      horizon: 3,
      croissanceChiffreAffaires: [10, 5, 0],
      effectifs: [
        { libelle: "Équipe", effectifs: [1, 2, 3], salaireAnnuelBrut: 100, tauxChargesSociales: 0 },
      ],
      emprunts: [{ libelle: "Prêt", anneeDeblocage: 1, montant: 1, tauxAnnuel: 5, duree: 1 }],
    });
    expect(n.devise).toBe("EUR");
    expect(n.croissanceChiffreAffaires).toEqual([10, 5, 0]);
    expect(n.effectifs[0]?.revalorisationAnnuelle).toBe(0);
    expect(n.emprunts[0]).toMatchObject({ differe: 0, mode: "annuites_constantes" });
  });

  it("refuse un tableau annuel de mauvaise longueur", () => {
    expect(erreurDe({ ...minimal, horizon: 3, croissanceChiffreAffaires: [1, 2] })).toEqual({
      code: "HYPOTHESE_INVALIDE",
      chemin: "croissanceChiffreAffaires",
    });
  });

  it.each<[string, Partial<HypothesesPlan>, string, string]>([
    ["devise", { devise: "GBP" as never }, "HYPOTHESE_INVALIDE", "devise"],
    ["exercice", { premierExercice: 1850 }, "HYPOTHESE_INVALIDE", "premierExercice"],
    [
      "CA négatif",
      { chiffreAffairesReference: -1 },
      "MONTANT_INVALIDE",
      "chiffreAffairesReference",
    ],
    [
      "CA décimal",
      { chiffreAffairesReference: 1.5 },
      "MONTANT_INVALIDE",
      "chiffreAffairesReference",
    ],
    [
      "croissance −100 %",
      { croissanceChiffreAffaires: -100 },
      "HYPOTHESE_INVALIDE",
      "croissanceChiffreAffaires[0]",
    ],
    ["marge > 100", { tauxMargeBrute: 101 }, "HYPOTHESE_INVALIDE", "tauxMargeBrute[0]"],
    ["marge infinie", { tauxMargeBrute: Infinity }, "HYPOTHESE_INVALIDE", "tauxMargeBrute[0]"],
    [
      "charges variables",
      { tauxChargesVariables: -1 },
      "HYPOTHESE_INVALIDE",
      "tauxChargesVariables[0]",
    ],
    ["charges fixes", { chargesFixes: -10 }, "MONTANT_INVALIDE", "chargesFixes[0]"],
    ["délai clients", { delaiClientsJours: 721 }, "HYPOTHESE_INVALIDE", "delaiClientsJours[0]"],
    [
      "délai fournisseurs",
      { delaiFournisseursJours: -1 },
      "HYPOTHESE_INVALIDE",
      "delaiFournisseursJours[0]",
    ],
    ["stocks", { stocksJours: Number.NaN }, "HYPOTHESE_INVALIDE", "stocksJours[0]"],
    ["IS", { tauxImpotSocietes: 120 }, "HYPOTHESE_INVALIDE", "tauxImpotSocietes"],
    [
      "dividendes",
      { tauxDistributionDividendes: -5 },
      "HYPOTHESE_INVALIDE",
      "tauxDistributionDividendes",
    ],
    ["actualisation", { tauxActualisation: -100 }, "HYPOTHESE_INVALIDE", "tauxActualisation"],
    [
      "effectif libellé",
      { effectifs: [{ libelle: "", effectifs: 1, salaireAnnuelBrut: 1, tauxChargesSociales: 0 }] },
      "HYPOTHESE_INVALIDE",
      "effectifs[0].libelle",
    ],
    [
      "effectif négatif",
      {
        effectifs: [{ libelle: "A", effectifs: -1, salaireAnnuelBrut: 1, tauxChargesSociales: 0 }],
      },
      "HYPOTHESE_INVALIDE",
      "effectifs[0].effectifs[0]",
    ],
    [
      "salaire",
      {
        effectifs: [{ libelle: "A", effectifs: 1, salaireAnnuelBrut: 0.5, tauxChargesSociales: 0 }],
      },
      "MONTANT_INVALIDE",
      "effectifs[0].salaireAnnuelBrut",
    ],
    [
      "charges sociales",
      {
        effectifs: [{ libelle: "A", effectifs: 1, salaireAnnuelBrut: 1, tauxChargesSociales: 101 }],
      },
      "HYPOTHESE_INVALIDE",
      "effectifs[0].tauxChargesSociales",
    ],
    [
      "revalorisation",
      {
        effectifs: [
          {
            libelle: "A",
            effectifs: 1,
            salaireAnnuelBrut: 1,
            tauxChargesSociales: 0,
            revalorisationAnnuelle: -100,
          },
        ],
      },
      "HYPOTHESE_INVALIDE",
      "effectifs[0].revalorisationAnnuelle",
    ],
    [
      "investissement hors horizon",
      { investissements: [{ libelle: "I", annee: 6, montant: 1, dureeAmortissement: 1 }] },
      "INVESTISSEMENT_INVALIDE",
      "investissements[0].annee",
    ],
    [
      "investissement nul",
      { investissements: [{ libelle: "I", annee: 1, montant: 0, dureeAmortissement: 1 }] },
      "MONTANT_INVALIDE",
      "investissements[0].montant",
    ],
    [
      "durée d'amortissement",
      { investissements: [{ libelle: "I", annee: 1, montant: 1, dureeAmortissement: 0 }] },
      "INVESTISSEMENT_INVALIDE",
      "investissements[0].dureeAmortissement",
    ],
    [
      "investissement sans libellé",
      { investissements: [{ libelle: "", annee: 1, montant: 1, dureeAmortissement: 1 }] },
      "HYPOTHESE_INVALIDE",
      "investissements[0].libelle",
    ],
    [
      "emprunt hors horizon",
      { emprunts: [{ libelle: "E", anneeDeblocage: 6, montant: 1, tauxAnnuel: 1, duree: 1 }] },
      "EMPRUNT_INVALIDE",
      "emprunts[0].anneeDeblocage",
    ],
    [
      "augmentation de capital",
      { augmentationsCapital: [{ annee: 0, montant: 1 }] },
      "HYPOTHESE_INVALIDE",
      "augmentationsCapital[0].annee",
    ],
    [
      "augmentation nulle",
      { augmentationsCapital: [{ annee: 1, montant: 0 }] },
      "MONTANT_INVALIDE",
      "augmentationsCapital[0].montant",
    ],
    [
      "trésorerie d'ouverture décimale",
      { bilanOuverture: { tresorerie: 0.5 } },
      "MONTANT_INVALIDE",
      "bilanOuverture.tresorerie",
    ],
    [
      "capital négatif",
      { bilanOuverture: { capital: -1, reserves: 1 } },
      "MONTANT_INVALIDE",
      "bilanOuverture.capital",
    ],
    [
      "immobilisations sans durée résiduelle",
      { bilanOuverture: { immobilisationsNettes: 100, capital: 100 } },
      "HYPOTHESE_INVALIDE",
      "bilanOuverture.dureeResiduelleImmobilisations",
    ],
  ])("refuse : %s", (_nom, ecart, code, chemin) => {
    expect(erreurDe({ ...minimal, ...ecart })).toEqual({ code, chemin });
  });

  it("refuse un bilan d'ouverture déséquilibré", () => {
    expect(erreurDe({ ...minimal, bilanOuverture: { tresorerie: 100, capital: 90 } })).toEqual({
      code: "BILAN_OUVERTURE_DESEQUILIBRE",
      chemin: "bilanOuverture",
    });
  });

  it("équilibre d'ouverture avec emprunt en cours, réserves négatives et découvert", () => {
    const n = normaliserHypotheses({
      ...minimal,
      emprunts: [{ libelle: "En cours", anneeDeblocage: 0, montant: 400, tauxAnnuel: 5, duree: 2 }],
      bilanOuverture: {
        immobilisationsNettes: 1_000,
        dureeResiduelleImmobilisations: 4,
        stocks: 100,
        creancesClients: 200,
        tresorerie: -50,
        capital: 1_000,
        reserves: -350,
        dettesFournisseurs: 200,
        deficitsReportables: 350,
      },
    });
    expect(n.bilanOuverture.reserves).toBe(-350);
  });
});
