import { describe, expect, it } from "vitest";
import * as preuves from "./index";
import {
  carteTriangulation,
  contradictionsAArbitrer,
  detecterAssertionsSansPreuve,
  ErreurPreuves,
  indiceSolidite,
  lectureSolidite,
  regrouperPreuvesAssertion,
  regrouperPreuvesParAssertion,
  type FiabilitePreuve,
  type PreuveAssertion,
  type TypeSourcePreuve,
} from "./index";

let n = 0;
const p = (
  typeSource: TypeSourcePreuve,
  fiabilite: FiabilitePreuve,
  sens: "pour" | "contre" = "pour",
  extra: Partial<PreuveAssertion> = {},
): PreuveAssertion => ({ id: `p${++n}`, typeSource, fiabilite, sens, ...extra });

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurPreuves);
    return (e as ErreurPreuves).code;
  }
  return undefined;
};

describe("indiceSolidite (PRV-02)", () => {
  it("une seule source A : 0,5, étayée", () => {
    const r = indiceSolidite({ preuves: [p("questionnaire", "A")] });
    expect(r).toMatchObject({ indice: 0.5, numerateur: 100, denominateur: 200, lecture: "etayee" });
  });

  it("deux sources indépendantes fiables : solide", () => {
    expect(
      indiceSolidite({ preuves: [p("questionnaire", "A"), p("entretien", "A")] }),
    ).toMatchObject({ indice: 1, lecture: "solide", plafonnee: false, sommeCentiemes: 200 });
    // B + B = 1,5 / 2 = 0,75 : à la borne, solide.
    expect(indiceSolidite({ preuves: [p("document", "B"), p("observation", "B")] })).toMatchObject({
      indice: 0.75,
      lecture: "solide",
    });
  });

  it("retient la meilleure fiabilité par type : deux preuves du même type ne triangulent pas", () => {
    const r = indiceSolidite({
      preuves: [p("entretien", "C"), p("entretien", "A"), p("entretien", "B")],
    });
    expect(r.indice).toBe(0.5);
    expect(r.fiabilitesRetenues).toEqual([
      { typeSource: "entretien", fiabilite: "A", poidsCentiemes: 100 },
    ]);
    expect(r.preuvesPour).toBe(3);
  });

  it("plafonne la somme à 2", () => {
    const r = indiceSolidite({
      preuves: [p("questionnaire", "A"), p("entretien", "A"), p("document", "B")],
    });
    expect(r).toMatchObject({ indice: 1, sommeCentiemes: 275, plafonnee: true, numerateur: 200 });
    expect(r.fiabilitesRetenues.map((f) => f.typeSource)).toEqual([
      "questionnaire",
      "entretien",
      "document",
    ]);
  });

  it("lectures aux bornes, sans bruit flottant", () => {
    const cas: [FiabilitePreuve[], number, string][] = [
      [["B", "C", "D"], 0.75, "solide"],
      [["B", "D"], 0.5, "etayee"],
      [["C", "D"], 0.375, "fragile"],
      [["D"], 0.125, "fragile"],
      [[], 0, "fragile"],
    ];
    const types: TypeSourcePreuve[] = ["questionnaire", "entretien", "observation"];
    for (const [fiabilites, indice, lecture] of cas) {
      const r = indiceSolidite({ preuves: fiabilites.map((f, i) => p(types[i]!, f)) });
      expect([r.indice, r.lecture]).toEqual([indice, lecture]);
    }
  });

  it("une contradiction non résolue divise l'indice par deux, une seule fois", () => {
    const base = [p("questionnaire", "A"), p("entretien", "A")];
    const contre = indiceSolidite({
      preuves: [...base, p("document", "A", "contre"), p("observation", "B", "contre")],
    });
    expect(contre).toMatchObject({
      indice: 0.5,
      denominateur: 400,
      lecture: "etayee",
      contradictionNonResolue: true,
      preuvesContre: 2,
    });
    // Une preuve contre ne compte jamais dans la somme.
    expect(contre.fiabilitesRetenues).toHaveLength(2);
  });

  it("une preuve contre arbitrée ne divise plus ; une contradiction externe si", () => {
    const base = [p("questionnaire", "A"), p("entretien", "A")];
    const arbitree = indiceSolidite({
      preuves: [...base, p("document", "A", "contre", { resolue: true })],
    });
    expect(arbitree).toMatchObject({ indice: 1, contradictionNonResolue: false });
    const externe = indiceSolidite({ preuves: base, contradictionsNonResolues: 1 });
    expect(externe).toMatchObject({ indice: 0.5, contradictionNonResolue: true });
    // B + C + contradiction = 0,625 / 2 = 0,3125 : fragile.
    const fragile = indiceSolidite({
      preuves: [p("document", "B"), p("entretien", "C"), p("observation", "A", "contre")],
    });
    expect([fragile.indice, fragile.lecture]).toEqual([0.3125, "fragile"]);
  });

  it("accepte une calibration (poids, plafond, seuils) et la contrôle", () => {
    const r = indiceSolidite(
      { preuves: [p("questionnaire", "A"), p("entretien", "B")] },
      {
        poidsCentiemes: { A: 100, B: 80, C: 40, D: 0 },
        plafondCentiemes: 300,
        seuils: { solide: 8_000, etayee: 6_000 },
      },
    );
    expect(r).toMatchObject({ numerateur: 180, denominateur: 300, indice: 0.6, lecture: "etayee" });
    expect(
      code(() => indiceSolidite({ preuves: [] }, { poidsCentiemes: { A: 101, B: 1, C: 1, D: 1 } })),
    ).toBe("OPTIONS_INVALIDES");
    expect(code(() => indiceSolidite({ preuves: [] }, { plafondCentiemes: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(
      code(() => indiceSolidite({ preuves: [] }, { seuils: { solide: 4_000, etayee: 5_000 } })),
    ).toBe("OPTIONS_INVALIDES");
    expect(code(() => indiceSolidite({ preuves: [], contradictionsNonResolues: -1 }))).toBe(
      "ASSERTION_INVALIDE",
    );
  });

  it("refuse une preuve mal formée ou en double", () => {
    const a = p("questionnaire", "A");
    expect(code(() => indiceSolidite({ preuves: [a, a] }))).toBe("PREUVE_INVALIDE");
    expect(code(() => indiceSolidite({ preuves: [p("rumeur" as never, "A")] }))).toBe(
      "PREUVE_INVALIDE",
    );
    expect(code(() => indiceSolidite({ preuves: [p("document", "E" as never)] }))).toBe(
      "PREUVE_INVALIDE",
    );
    expect(code(() => indiceSolidite({ preuves: [p("document", "A", "neutre" as never)] }))).toBe(
      "PREUVE_INVALIDE",
    );
    expect(code(() => indiceSolidite({ preuves: [{ ...a, id: "" }] }))).toBe("PREUVE_INVALIDE");
  });

  it("lectureSolidite contrôle la fraction", () => {
    expect(lectureSolidite(3, 4)).toBe("solide");
    expect(lectureSolidite(1, 2)).toBe("etayee");
    expect(lectureSolidite(0, 1)).toBe("fragile");
    expect(code(() => lectureSolidite(1, 0))).toBe("OPTIONS_INVALIDES");
    expect(code(() => lectureSolidite(-1, 2))).toBe("OPTIONS_INVALIDES");
  });
});

describe("regroupement pour / contre (PRV-04)", () => {
  it("sépare et trie par fiabilité puis identifiant", () => {
    const r = regrouperPreuvesAssertion([
      { id: "b", typeSource: "document", fiabilite: "C", sens: "pour" },
      { id: "a", typeSource: "entretien", fiabilite: "C", sens: "pour" },
      { id: "c", typeSource: "observation", fiabilite: "A", sens: "pour" },
      { id: "z", typeSource: "document", fiabilite: "B", sens: "contre", resolue: true },
      { id: "y", typeSource: "document", fiabilite: "B", sens: "contre" },
    ]);
    expect(r.pour.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(r.contre.map((x) => x.id)).toEqual(["y", "z"]);
    expect(r).toMatchObject({
      contradiction: true,
      contradictionNonResolue: true,
      aArbitrer: ["y"],
    });
    expect(regrouperPreuvesAssertion([])).toMatchObject({
      contradiction: false,
      contradictionNonResolue: false,
    });
  });

  it("regroupe des liens par assertion, groupes triés", () => {
    const liens = [
      { assertion: "as2", id: "p1", typeSource: "document", fiabilite: "A", sens: "pour" },
      { assertion: "as1", id: "p1", typeSource: "document", fiabilite: "A", sens: "contre" },
      { assertion: "as1", id: "p2", typeSource: "entretien", fiabilite: "B", sens: "pour" },
      {
        assertion: "as3",
        id: "p3",
        typeSource: "entretien",
        fiabilite: "B",
        sens: "contre",
        resolue: true,
      },
    ] as const;
    const groupes = regrouperPreuvesParAssertion(liens);
    expect(groupes.map((g) => g.assertion)).toEqual(["as1", "as2", "as3"]);
    expect(groupes[0]).toMatchObject({ contradictionNonResolue: true, aArbitrer: ["p1"] });
    expect(groupes[0]!.pour.map((x) => x.id)).toEqual(["p2"]);
    expect(contradictionsAArbitrer(liens).map((g) => g.assertion)).toEqual(["as1"]);
  });

  it("refuse une preuve des deux côtés ou une assertion sans identifiant", () => {
    expect(
      code(() =>
        regrouperPreuvesParAssertion([
          { assertion: "a", id: "p", typeSource: "document", fiabilite: "A", sens: "pour" },
          { assertion: "a", id: "p", typeSource: "document", fiabilite: "A", sens: "contre" },
        ]),
      ),
    ).toBe("PREUVE_INVALIDE");
    expect(
      code(() =>
        regrouperPreuvesParAssertion([
          { assertion: "", id: "p", typeSource: "document", fiabilite: "A", sens: "pour" },
        ]),
      ),
    ).toBe("ASSERTION_INVALIDE");
    expect(
      code(() =>
        regrouperPreuvesParAssertion([
          { assertion: "a", id: "", typeSource: "document", fiabilite: "A", sens: "pour" },
        ]),
      ),
    ).toBe("PREUVE_INVALIDE");
  });
});

describe("carteTriangulation (PRV-05)", () => {
  const preuvesCarte = [
    { id: "q1", typeSource: "questionnaire", fiabilite: "B", dimensions: ["gouv", "rh"] },
    { id: "e1", typeSource: "entretien", fiabilite: "C", dimensions: ["gouv"] },
    { id: "e2", typeSource: "entretien", fiabilite: "A", dimensions: ["gouv", "gouv"] },
    { id: "d1", typeSource: "document", fiabilite: "D", dimensions: ["finance"] },
    { id: "x1", typeSource: "observation", fiabilite: "A", dimensions: ["inconnue", "rh"] },
  ] as const;

  it("croise sources et dimensions et signale les zones non couvertes", () => {
    const carte = carteTriangulation(["gouv", "rh", "finance", "strategie"], preuvesCarte, {
      typesAttendus: ["questionnaire", "entretien", "observation"],
    });
    expect(carte.dimensions.map((d) => [d.dimension, d.preuves, d.couverte, d.triangulee])).toEqual(
      [
        ["gouv", 3, true, true],
        ["rh", 2, true, true],
        ["finance", 1, true, false],
        ["strategie", 0, false, false],
      ],
    );
    const gouvEntretien = carte.cellules.find(
      (c) => c.dimension === "gouv" && c.typeSource === "entretien",
    );
    expect(gouvEntretien).toEqual({
      dimension: "gouv",
      typeSource: "entretien",
      preuves: 2,
      meilleureFiabilite: "A",
    });
    expect(carte.cellules).toHaveLength(20);
    expect(carte.dimensions[0]!.typesManquants).toEqual(["observation"]);
    expect(carte.zonesNonCouvertes).toContainEqual({ dimension: "rh", typeSource: "entretien" });
    // Le document n'est pas attendu : pas de zone non couverte « document ».
    expect(carte.zonesNonCouvertes.some((z) => z.typeSource === "document")).toBe(false);
    expect(carte.dimensionsNonCouvertes).toEqual(["strategie"]);
    expect(carte.dimensionsSousTriangulees).toEqual(["finance"]);
    expect(carte.rattachementsInconnus).toEqual([{ preuve: "x1", dimension: "inconnue" }]);
    expect(carte.preuvesEcartees).toEqual([]);
  });

  it("écarte les preuves sous la fiabilité minimale et exige le nombre de types demandé", () => {
    const carte = carteTriangulation(["gouv", "finance"], preuvesCarte, {
      fiabiliteMinimale: "B",
      typesMinimum: 1,
    });
    expect(carte.preuvesEcartees).toEqual(["d1", "e1"]);
    expect(carte.dimensions.map((d) => d.triangulee)).toEqual([true, false]);
    expect(carte.dimensionsNonCouvertes).toEqual(["finance"]);
    expect(carte.dimensions[0]!.typesManquants).toEqual([
      "observation",
      "document",
      "donnee_externe",
    ]);
  });

  it("refuse dimensions, preuves et options invalides", () => {
    expect(code(() => carteTriangulation(["a", "a"], []))).toBe("DIMENSION_INVALIDE");
    expect(code(() => carteTriangulation([""], []))).toBe("DIMENSION_INVALIDE");
    const q = { id: "q", typeSource: "questionnaire", fiabilite: "A", dimensions: ["a"] } as const;
    expect(code(() => carteTriangulation(["a"], [q, q]))).toBe("PREUVE_INVALIDE");
    expect(code(() => carteTriangulation(["a"], [{ ...q, dimensions: "a" as never }]))).toBe(
      "PREUVE_INVALIDE",
    );
    expect(code(() => carteTriangulation(["a"], [], { typesMinimum: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(
      code(() => carteTriangulation(["a"], [], { typesAttendus: ["document", "document"] })),
    ).toBe("OPTIONS_INVALIDES");
    expect(code(() => carteTriangulation(["a"], [], { fiabiliteMinimale: "Z" as never }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });
});

describe("detecterAssertionsSansPreuve (PRV-03)", () => {
  it("contrôle R2 et R3 seulement, accepte un avis d'expert signé", () => {
    const r = detecterAssertionsSansPreuve([
      { id: "z", classeRisque: "R3", preuves: [{ id: "p1", sens: "contre" }] },
      { id: "a", classeRisque: "R2", preuves: [{ id: "p2", sens: "pour" }] },
      { id: "b", classeRisque: "R2", preuves: [], avisExpert: true, signee: true },
      { id: "c", classeRisque: "R3", preuves: [], avisExpert: true },
      { id: "d", classeRisque: "R1", preuves: [] },
      { id: "e", classeRisque: "R0", preuves: [] },
    ]);
    expect(r).toEqual({
      conforme: false,
      controlees: 4,
      ignorees: 2,
      anomalies: [
        { assertion: "c", classeRisque: "R3", code: "AVIS_EXPERT_NON_SIGNE" },
        { assertion: "z", classeRisque: "R3", code: "SANS_PREUVE" },
      ],
    });
    expect(detecterAssertionsSansPreuve([]).conforme).toBe(true);
  });

  it("refuse une assertion mal formée", () => {
    expect(
      code(() => detecterAssertionsSansPreuve([{ id: "", classeRisque: "R2", preuves: [] }])),
    ).toBe("ASSERTION_INVALIDE");
    const a = { id: "a", classeRisque: "R2", preuves: [] } as const;
    expect(code(() => detecterAssertionsSansPreuve([a, a]))).toBe("ASSERTION_INVALIDE");
    expect(code(() => detecterAssertionsSansPreuve([{ ...a, classeRisque: "R5" as never }]))).toBe(
      "ASSERTION_INVALIDE",
    );
  });
});

describe("API publique du domaine preuves", () => {
  it("expose les moteurs", () => {
    for (const nom of [
      "ErreurPreuves",
      "indiceSolidite",
      "lectureSolidite",
      "regrouperPreuvesAssertion",
      "regrouperPreuvesParAssertion",
      "contradictionsAArbitrer",
      "carteTriangulation",
      "detecterAssertionsSansPreuve",
      "POIDS_FIABILITE_CENTIEMES",
      "estTypeSourcePreuve",
      "estFiabilitePreuve",
      "rangFiabilite",
    ]) {
      expect(preuves).toHaveProperty(nom);
    }
  });
});
