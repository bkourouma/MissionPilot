import { describe, expect, it } from "vitest";
import {
  COVENANTS_PAR_VERSION_MAX,
  type DefinitionCovenant,
  RATIOS_COVENANT_RED,
  evaluerCovenants,
  validerCovenants,
} from "./covenants";
import { ErreurRedressement } from "./erreurs";
import {
  CLES_RATIO_REDRESSEMENT,
  type CleRatioRedressement,
  type RatioRedressement,
} from "./ratios";

const calcule = (valeur: number): RatioRedressement => ({
  valeur,
  statut: "calcule",
  raison: null,
  manquants: [],
});
const ratios = (
  surcharges: Partial<Record<CleRatioRedressement, RatioRedressement>> = {},
): Record<CleRatioRedressement, RatioRedressement> => {
  const base = {} as Record<CleRatioRedressement, RatioRedressement>;
  for (const cle of CLES_RATIO_REDRESSEMENT) base[cle] = calcule(10_000);
  return { ...base, ...surcharges };
};
const cov = (surcharges: Partial<DefinitionCovenant> = {}): DefinitionCovenant => ({
  ratio: "liquidite_generale",
  operateur: "min",
  seuilPb: 12_000,
  preteur: null,
  frequence: "annuelle",
  ...surcharges,
});

describe("liste fermée", () => {
  it("les ratios de covenant sont des ratios du moteur", () => {
    for (const r of RATIOS_COVENANT_RED) expect(CLES_RATIO_REDRESSEMENT).toContain(r);
  });
});

describe("evaluerCovenants", () => {
  it("min : valeur sous le seuil = en_defaut, marge négative ; égale = respecte, marge nulle", () => {
    const r = evaluerCovenants(
      [cov({ seuilPb: 13_636 }), cov({ ratio: "endettement", operateur: "max", seuilPb: 12_000 })],
      ratios({ liquidite_generale: calcule(13_636), endettement: calcule(13_333) }),
    );
    expect(r.evaluations[0]).toMatchObject({ statut: "respecte", valeurPb: 13_636, margePb: 0 });
    expect(r.evaluations[1]).toMatchObject({
      statut: "en_defaut",
      valeurPb: 13_333,
      margePb: -1_333,
    });
    expect(r.synthese).toEqual({ nombre: 2, respectes: 1, enDefaut: 1, nonCalculables: 0 });
  });

  it("max respecté : marge = seuil − valeur ; min respecté : valeur − seuil", () => {
    const r = evaluerCovenants(
      [cov({ ratio: "endettement", operateur: "max", seuilPb: 15_000 }), cov({ seuilPb: 9_000 })],
      ratios({ endettement: calcule(13_333) }),
    );
    expect(r.evaluations.map((e) => e.margePb)).toEqual([1_667, 1_000]);
    expect(r.evaluations.map((e) => e.statut)).toEqual(["respecte", "respecte"]);
  });

  it("ratio négatif et seuil négatif acceptés", () => {
    const r = evaluerCovenants(
      [cov({ ratio: "couverture_charges_financieres", seuilPb: -5_000 })],
      ratios({ couverture_charges_financieres: calcule(-20_000) }),
    );
    expect(r.evaluations[0]).toMatchObject({ statut: "en_defaut", margePb: -15_000 });
  });

  it("non calculable : sans exercice accepté, ratio non calculable, sans objet, non significatif", () => {
    const sans = evaluerCovenants([cov()], null);
    expect(sans.evaluations[0]).toMatchObject({
      statut: "non_calculable",
      raison: "aucun_etat_accepte",
      valeurPb: null,
      margePb: null,
    });
    const r = evaluerCovenants(
      [
        cov(),
        cov({ ratio: "liquidite_reduite" }),
        cov({ ratio: "endettement", operateur: "max" }),
        cov({ ratio: "autonomie_financiere" }),
      ],
      ratios({
        liquidite_generale: {
          valeur: null,
          statut: "non_calculable",
          raison: "postes_manquants",
          manquants: ["stocks"],
        },
        liquidite_reduite: {
          valeur: null,
          statut: "sans_objet",
          raison: "sans_dette",
          manquants: [],
        },
        endettement: {
          valeur: null,
          statut: "non_significatif",
          raison: "denominateur_non_positif",
          manquants: [],
        },
      }),
    );
    expect(r.evaluations.map((e) => e.raison)).toEqual([
      "ratio_non_calculable",
      "ratio_sans_objet",
      "ratio_non_significatif",
      null,
    ]);
    expect(r.evaluations[0]?.manquants).toEqual(["stocks"]);
    expect(r.synthese).toEqual({ nombre: 4, respectes: 0, enDefaut: 1, nonCalculables: 3 });
  });

  it("une valeur absente malgré le statut « calcule » reste non calculable", () => {
    const r = evaluerCovenants(
      [cov()],
      ratios({
        liquidite_generale: { valeur: null, statut: "calcule", raison: null, manquants: [] },
      }),
    );
    expect(r.evaluations[0]).toMatchObject({
      statut: "non_calculable",
      raison: "ratio_non_calculable",
    });
  });

  it("liste vide : synthèse à zéro", () => {
    expect(evaluerCovenants([], ratios()).synthese).toEqual({
      nombre: 0,
      respectes: 0,
      enDefaut: 0,
      nonCalculables: 0,
    });
  });
});

describe("validerCovenants", () => {
  const rejette = (liste: unknown[]) =>
    expect(() => validerCovenants(liste as DefinitionCovenant[])).toThrowError(ErreurRedressement);

  it("accepte un plancher et un plafond cohérents, et un prêteur borné", () => {
    expect(() =>
      validerCovenants([
        cov({ seuilPb: 10_000 }),
        cov({ operateur: "max", seuilPb: 10_000 }),
        cov({ ratio: "endettement", operateur: "max", preteur: "Banque X" }),
      ]),
    ).not.toThrow();
  });

  it("refuse : ratio, opérateur, fréquence inconnus ; seuil décimal ou hors bornes", () => {
    rejette([cov({ ratio: "marge_brute" as never })]);
    rejette([cov({ operateur: "egal" as never })]);
    rejette([cov({ frequence: "mensuelle" as never })]);
    rejette([cov({ seuilPb: 1.5 })]);
    rejette([cov({ seuilPb: 100_000_001 })]);
    rejette([cov({ seuilPb: Number.NaN })]);
  });

  it("refuse : prêteur vide ou trop long, doublon, plancher > plafond, plus de 12", () => {
    rejette([cov({ preteur: "  " })]);
    rejette([cov({ preteur: "x".repeat(121) })]);
    rejette([cov(), cov({ seuilPb: 1 })]);
    rejette([cov({ seuilPb: 20_000 }), cov({ operateur: "max", seuilPb: 10_000 })]);
    rejette(
      Array.from({ length: COVENANTS_PAR_VERSION_MAX + 1 }, (_, i) =>
        cov({ ratio: RATIOS_COVENANT_RED[i % RATIOS_COVENANT_RED.length] as never, seuilPb: i }),
      ),
    );
  });
});
