import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import {
  dimensionnerMarche,
  recouperDimensionnements,
  SEUIL_RECOUPEMENT_BP,
  type ParametreDimensionnement,
  type SourceParametre,
} from "./dimensionnement";

const src = (s: SourceParametre | null): SourceParametre | null => s;

function p(
  code: string,
  bas: number,
  base: number,
  haut: number,
  source: SourceParametre | null = { type: "avis_expert" },
): ParametreDimensionnement {
  return { code, bas, base, haut, source: src(source) };
}

const MD = 1_000_000_000;
const descendant = (sources: (SourceParametre | null)[] = []): ParametreDimensionnement[] => [
  p("marche_total", 80 * MD, 100 * MD, 120 * MD, sources[0]),
  p("part_segment", 3_000, 4_000, 5_000, sources[1]),
  p("part_adressable", 4_000, 5_000, 6_000, sources[2]),
  p("part_capturable", 800, 1_000, 1_200, sources[3]),
];
const ascendant = (): ParametreDimensionnement[] => [
  p("clients_cibles", 1_500, 2_000, 2_500),
  p("taux_conquete", 1_500, 2_000, 2_500),
  p("volume_par_client", 10, 12, 14),
  p("prix_unitaire", 200_000, 250_000, 300_000),
];
const uniforme = (c: number, t: number, v: number, pu: number): ParametreDimensionnement[] => [
  p("clients_cibles", c, c, c),
  p("taux_conquete", t, t, t),
  p("volume_par_client", v, v, v),
  p("prix_unitaire", pu, pu, pu),
];

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDueDiligence);
    return (e as ErreurDueDiligence).code;
  }
  return undefined;
}

describe("dimensionnerMarche : descendant (D1, D2)", () => {
  const r = dimensionnerMarche({
    methode: "descendant",
    parametres: descendant([{ type: "avis_expert" }, { type: "avis_expert" }, null, null]),
  });

  it("D1 : trois étages exacts", () => {
    expect(r.etages).toEqual([
      { code: "marche_total", valeurs: { bas: 80 * MD, base: 100 * MD, haut: 120 * MD } },
      {
        code: "marche_adressable",
        valeurs: { bas: 9_600_000_000, base: 20_000_000_000, haut: 36_000_000_000 },
      },
      {
        code: "marche_capturable",
        valeurs: { bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 },
      },
    ]);
    expect(r.resultat).toEqual(r.avantAjustement);
    expect(r.resultat).toEqual({ bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 });
    expect(r.ajuste).toBe(false);
    expect(r.ajustementsAppliques).toEqual([]);
  });

  it("D1 : sensibilité triée par amplitude puis code", () => {
    expect(r.sensibilite).toEqual([
      {
        code: "part_segment",
        resultatBas: 1_500_000_000,
        resultatHaut: 2_500_000_000,
        amplitude: 1_000_000_000,
        partAmplitudeBp: 10_000,
      },
      {
        code: "marche_total",
        resultatBas: 1_600_000_000,
        resultatHaut: 2_400_000_000,
        amplitude: 800_000_000,
        partAmplitudeBp: 8_000,
      },
      {
        code: "part_adressable",
        resultatBas: 1_600_000_000,
        resultatHaut: 2_400_000_000,
        amplitude: 800_000_000,
        partAmplitudeBp: 8_000,
      },
      {
        code: "part_capturable",
        resultatBas: 1_600_000_000,
        resultatHaut: 2_400_000_000,
        amplitude: 800_000_000,
        partAmplitudeBp: 8_000,
      },
    ]);
  });

  it("D2 : deux ajustements, un seul arrondi sur la fraction exacte (facteur 0,855)", () => {
    const aj = dimensionnerMarche({
      methode: "descendant",
      parametres: descendant(),
      ajustements: [
        { libelle: "Informel", facteurBp: 9_000 },
        { libelle: "Change", facteurBp: 9_500 },
      ],
    });
    expect(aj.avantAjustement).toEqual({
      bas: 768_000_000,
      base: 2_000_000_000,
      haut: 4_320_000_000,
    });
    expect(aj.resultat).toEqual({ bas: 656_640_000, base: 1_710_000_000, haut: 3_693_600_000 });
    expect(aj.ajuste).toBe(true);
    expect(aj.ajustementsAppliques).toEqual([
      { libelle: "Informel", facteurBp: 9_000, base: 1_800_000_000 },
      { libelle: "Change", facteurBp: 9_500, base: 1_710_000_000 },
    ]);
  });

  it("l'ajustement se calcule sur la fraction exacte, pas sur l'étage arrondi", () => {
    // Étage exact 0,5 (arrondi à 1) et facteur 0,5 : exact 0,25 → 0 (et non 1 × 0,5 = 0,5 → 1).
    const r2 = dimensionnerMarche({
      methode: "ascendant",
      parametres: uniforme(1, 5_000, 1, 1),
      ajustements: [{ libelle: "Moitié", facteurBp: 5_000 }],
    });
    expect(r2.avantAjustement.base).toBe(1);
    expect(r2.resultat.base).toBe(0);
  });

  it("l'ordre des paramètres reçus est sans effet", () => {
    const inverse = dimensionnerMarche({
      methode: "descendant",
      parametres: [...descendant()].reverse(),
    });
    expect(inverse.etages).toEqual(
      dimensionnerMarche({ methode: "descendant", parametres: descendant() }).etages,
    );
    expect(inverse.sensibilite.map((s) => s.code)).toEqual([
      "part_segment",
      "marche_total",
      "part_adressable",
      "part_capturable",
    ]);
  });
});

describe("dimensionnerMarche : ascendant (A1) et arrondis (R1 à R3)", () => {
  it("A1 : un seul étage, fourchette et sensibilité", () => {
    const r = dimensionnerMarche({ methode: "ascendant", parametres: ascendant() });
    expect(r.etages).toEqual([
      {
        code: "marche_atteignable",
        valeurs: { bas: 450_000_000, base: 1_200_000_000, haut: 2_625_000_000 },
      },
    ]);
    expect(r.sensibilite).toEqual([
      {
        code: "clients_cibles",
        resultatBas: 900_000_000,
        resultatHaut: 1_500_000_000,
        amplitude: 600_000_000,
        partAmplitudeBp: 10_000,
      },
      {
        code: "taux_conquete",
        resultatBas: 900_000_000,
        resultatHaut: 1_500_000_000,
        amplitude: 600_000_000,
        partAmplitudeBp: 10_000,
      },
      {
        code: "prix_unitaire",
        resultatBas: 960_000_000,
        resultatHaut: 1_440_000_000,
        amplitude: 480_000_000,
        partAmplitudeBp: 8_000,
      },
      {
        code: "volume_par_client",
        resultatBas: 1_000_000_000,
        resultatHaut: 1_400_000_000,
        amplitude: 400_000_000,
        partAmplitudeBp: 6_667,
      },
    ]);
  });

  it("R1 : 1,5 arrondi à 2 (demi s'éloignant de zéro)", () => {
    const r = dimensionnerMarche({ methode: "ascendant", parametres: uniforme(3, 5_000, 1, 1) });
    expect(r.resultat.base).toBe(2);
  });

  it("R2 : 0,4999 → 0 et 0,5001 → 1 (clients_cibles = 1 ; avec 3 clients : 1,4997 → 1 et 1,5003 → 2)", () => {
    expect(
      dimensionnerMarche({ methode: "ascendant", parametres: uniforme(1, 4_999, 1, 1) }).resultat
        .base,
    ).toBe(0);
    expect(
      dimensionnerMarche({ methode: "ascendant", parametres: uniforme(1, 5_001, 1, 1) }).resultat
        .base,
    ).toBe(1);
    expect(
      dimensionnerMarche({ methode: "ascendant", parametres: uniforme(3, 4_999, 1, 1) }).resultat
        .base,
    ).toBe(1);
    expect(
      dimensionnerMarche({ methode: "ascendant", parametres: uniforme(3, 5_001, 1, 1) }).resultat
        .base,
    ).toBe(2);
  });

  it("R3 : tout à zéro", () => {
    const r = dimensionnerMarche({ methode: "ascendant", parametres: uniforme(0, 0, 0, 0) });
    expect(r.resultat).toEqual({ bas: 0, base: 0, haut: 0 });
    expect(r.sensibilite.every((s) => s.amplitude === 0 && s.partAmplitudeBp === 0)).toBe(true);
  });
});

describe("dimensionnerMarche : sources (C1)", () => {
  it("C1 : couverture des sources", () => {
    const r = dimensionnerMarche({
      methode: "descendant",
      parametres: descendant([
        { type: "preuve", preuveId: "p1" },
        { type: "preuve", preuveId: "p2" },
        { type: "avis_expert" },
        null,
      ]),
    });
    expect(r.couverture).toEqual({
      total: 4,
      preuve: 2,
      avisExpert: 1,
      absente: ["part_capturable"],
    });
  });
});

describe("dimensionnerMarche : erreurs (E1, E2)", () => {
  it("E1 : dépassement de l'entier sûr", () => {
    expect(
      code(() =>
        dimensionnerMarche({
          methode: "descendant",
          parametres: [
            p("marche_total", 9_007_199_254_740_991, 9_007_199_254_740_991, 9_007_199_254_740_991),
            p("part_segment", 10_000, 10_000, 10_000),
            p("part_adressable", 10_000, 10_000, 10_000),
            p("part_capturable", 10_000, 10_000, 10_000),
          ],
          ajustements: [{ libelle: "Double", facteurBp: 20_000 }],
        }),
      ),
    ).toBe("DEPASSEMENT");
  });

  it("E2 : paramètres invalides", () => {
    const e = (
      parametres: ParametreDimensionnement[],
      ajustements?: { libelle: string; facteurBp: number }[],
    ) => code(() => dimensionnerMarche({ methode: "descendant", parametres, ajustements }));
    const base = descendant();
    expect(e([p("marche_total", 10, 5, 20), ...base.slice(1)])).toBe("BORNES_INCOHERENTES");
    expect(e([p("marche_total", 1, 5, 4), ...base.slice(1)])).toBe("BORNES_INCOHERENTES");
    expect(e(base.slice(0, 3))).toBe("PARAMETRE_MANQUANT");
    expect(e([...base.slice(0, 3), p("inconnu", 1, 1, 1)])).toBe("PARAMETRE_INVALIDE");
    expect(e([...base, p("marche_total", 1, 1, 1)])).toBe("PARAMETRE_INVALIDE");
    expect(e([...base.slice(0, 3), p("part_capturable", 10_001, 10_001, 10_001)])).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(e([p("marche_total", 1.5, 2, 3), ...base.slice(1)])).toBe("PARAMETRE_INVALIDE");
    expect(e([p("marche_total", -1, 2, 3), ...base.slice(1)])).toBe("PARAMETRE_INVALIDE");
    expect(e([p("marche_total", 1, 2, Number.MAX_SAFE_INTEGER + 1), ...base.slice(1)])).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(e(base, [{ libelle: "x", facteurBp: 0 }])).toBe("PARAMETRE_INVALIDE");
    expect(e(base, [{ libelle: "x", facteurBp: 20_001 }])).toBe("PARAMETRE_INVALIDE");
    expect(e(base, [{ libelle: "x", facteurBp: 1.5 }])).toBe("PARAMETRE_INVALIDE");
    expect(
      e(
        base,
        Array.from({ length: 11 }, () => ({ libelle: "x", facteurBp: 10_000 })),
      ),
    ).toBe("PARAMETRE_INVALIDE");
    expect(
      e(
        base,
        Array.from({ length: 10 }, () => ({ libelle: "x", facteurBp: 10_000 })),
      ),
    ).toBeUndefined();
  });

  it("méthode inconnue", () => {
    expect(
      code(() =>
        dimensionnerMarche({
          methode: "hybride" as unknown as "descendant",
          parametres: descendant(),
        }),
      ),
    ).toBe("PARAMETRE_INVALIDE");
  });
});

describe("recouperDimensionnements (X1 à X3)", () => {
  const d = { bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 };
  const a = { bas: 450_000_000, base: 1_200_000_000, haut: 2_625_000_000 };

  it("X1 : écart de 40 %, alerte, fourchettes qui se recoupent", () => {
    expect(recouperDimensionnements(d, a)).toEqual({
      ecartBp: 4_000,
      plusEleve: "descendant",
      alerte: true,
      chevauchement: true,
    });
  });

  it("X2 : fourchettes disjointes, ascendant plus élevé", () => {
    expect(
      recouperDimensionnements({ bas: 10, base: 20, haut: 30 }, { bas: 40, base: 50, haut: 60 }),
    ).toEqual({ ecartBp: 6_000, plusEleve: "ascendant", alerte: true, chevauchement: false });
  });

  it("X3 : arrondi, égalité, nuls, seuil strict", () => {
    const f = (n: number) => ({ bas: n, base: n, haut: n });
    expect(recouperDimensionnements(f(1), f(3)).ecartBp).toBe(6_667);
    expect(recouperDimensionnements(f(7), f(7))).toMatchObject({ ecartBp: 0, plusEleve: "egal" });
    expect(recouperDimensionnements(f(0), f(0))).toMatchObject({
      ecartBp: 0,
      plusEleve: "egal",
      alerte: false,
    });
    expect(recouperDimensionnements(d, a, 4_000).alerte).toBe(false);
    expect(recouperDimensionnements(d, a, 3_999).alerte).toBe(true);
    expect(SEUIL_RECOUPEMENT_BP).toBe(3_000);
  });

  it("refuse des fourchettes ou un seuil invalides", () => {
    expect(code(() => recouperDimensionnements({ bas: 5, base: 1, haut: 9 }, a))).toBe(
      "BORNES_INCOHERENTES",
    );
    expect(code(() => recouperDimensionnements(d, { bas: 1, base: 5, haut: 3 }))).toBe(
      "BORNES_INCOHERENTES",
    );
    expect(code(() => recouperDimensionnements({ bas: 1.5, base: 2, haut: 3 }, a))).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(code(() => recouperDimensionnements(d, a, -1))).toBe("PARAMETRE_INVALIDE");
    expect(code(() => recouperDimensionnements(d, a, 10_001))).toBe("PARAMETRE_INVALIDE");
    expect(code(() => recouperDimensionnements(d, a, 1.5))).toBe("PARAMETRE_INVALIDE");
  });
});
