import { describe, expect, it } from "vitest";
import { MAX_NOEUDS_ARBRE_KPI, decomposerArbreKpi, type NoeudArbreKpi } from "./arbre";
import { ErreurKpi } from "./erreurs";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

const n = (
  id: string,
  parentId: string | null,
  extra: Partial<NoeudArbreKpi> = {},
): NoeudArbreKpi => ({
  id,
  parentId,
  relation: "somme",
  coefficient: 1,
  rang: 0,
  avant: null,
  apres: null,
  ...extra,
});

describe("arbre d'indicateurs : somme", () => {
  // Marge = Chiffre d'affaires − Coûts ; le CA est lui-même ventes France + ventes export.
  const noeuds: NoeudArbreKpi[] = [
    n("marge", null, { avant: 300, apres: 340 }),
    n("ca", "marge", { rang: 1 }),
    n("couts", "marge", { rang: 2, coefficient: -1, avant: 700, apres: 720 }),
    n("france", "ca", { rang: 1, avant: 600, apres: 640 }),
    n("export", "ca", { rang: 2, avant: 400, apres: 420 }),
  ];

  it("la somme des contributions des leviers est exactement la variation de la racine", () => {
    const r = decomposerArbreKpi(noeuds, { sens: "plus_haut_mieux" });
    expect(r.evaluable).toBe(true);
    expect(r.variationRacine).toBe(40);
    const somme = r.leviers.reduce((s, l) => s + l.contributionRacine, 0);
    expect(somme).toBe(40);
    const parId = new Map(r.noeuds.map((x) => [x.id, x]));
    expect(parId.get("france")?.contributionRacine).toBe(40);
    expect(parId.get("export")?.contributionRacine).toBe(20);
    expect(parId.get("couts")?.contributionRacine).toBe(-20);
    expect(parId.get("ca")?.contributionParent).toBe(60);
    expect(parId.get("ca")?.avant).toBe(1000);
    expect(parId.get("ca")?.apres).toBe(1060);
  });

  it("classe les leviers par contribution absolue et dit s'ils sont favorables", () => {
    const r = decomposerArbreKpi(noeuds, { sens: "plus_haut_mieux" });
    expect(r.leviers.map((l) => [l.id, l.rang, l.favorable])).toEqual([
      ["france", 1, true],
      ["export", 2, true],
      ["couts", 3, false],
    ]);
    expect(r.leviers[0]?.partRacine).toBe(1);
    const inverse = decomposerArbreKpi(noeuds, { sens: "plus_bas_mieux" });
    expect(inverse.leviers.map((l) => l.favorable)).toEqual([false, false, true]);
  });

  it("mesure le résidu d'un nœud interne dont la valeur est observée", () => {
    const r = decomposerArbreKpi(
      [
        n("marge", null, { avant: 310, apres: 340 }),
        n("a", "marge", { rang: 1, avant: 100, apres: 120 }),
        n("b", "marge", { rang: 2, avant: 200, apres: 220 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    const racine = r.noeuds.find((x) => x.id === "marge");
    expect(racine?.avant).toBe(300);
    expect(racine?.residuAvant).toBe(10);
    expect(racine?.residuApres).toBe(0);
  });

  it("variation nulle : parts indéterminées, contributions nulles", () => {
    const r = decomposerArbreKpi(
      [
        n("r", null),
        n("a", "r", { rang: 1, avant: 10, apres: 12 }),
        n("b", "r", { rang: 2, avant: 10, apres: 8 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    expect(r.variationRacine).toBe(0);
    expect(r.leviers.map((l) => [l.contributionRacine, l.partRacine, l.favorable])).toEqual([
      [2, null, true],
      [-2, null, false],
    ]);
    const c = decomposerArbreKpi([n("r", null), n("a", "r", { rang: 1, avant: 10, apres: 10 })], {
      sens: "plus_haut_mieux",
    });
    expect(c.leviers[0]?.favorable).toBeNull();
  });

  it("variation nulle d'un nœud intermédiaire : sa descendance contribue 0 à la racine", () => {
    const r = decomposerArbreKpi(
      [
        n("r", null),
        n("m", "r", { rang: 1 }),
        n("x", "r", { rang: 2, avant: 5, apres: 9 }),
        n("a", "m", { rang: 1, avant: 10, apres: 12 }),
        n("b", "m", { rang: 2, coefficient: -1, avant: 10, apres: 12 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    const parId = new Map(r.noeuds.map((x) => [x.id, x]));
    expect(parId.get("m")?.variation).toBe(0);
    expect(parId.get("a")?.contributionRacine).toBe(0);
    expect(parId.get("b")?.contributionRacine).toBe(0);
    expect(parId.get("x")?.contributionRacine).toBe(4);
  });
});

describe("arbre d'indicateurs : produit", () => {
  // CA = clients × panier moyen.
  const noeuds: NoeudArbreKpi[] = [
    n("ca", null, { relation: "produit" }),
    n("clients", "ca", { rang: 1, avant: 100, apres: 110 }),
    n("panier", "ca", { rang: 2, avant: 50, apres: 60 }),
  ];

  it("substitution en chaîne : la somme des contributions est exactement la variation", () => {
    const r = decomposerArbreKpi(noeuds, { sens: "plus_haut_mieux" });
    // 100 × 50 = 5 000 puis 110 × 60 = 6 600 : variation 1 600.
    expect(r.variationRacine).toBe(1600);
    const parId = new Map(r.noeuds.map((x) => [x.id, x]));
    // clients d'abord : 110 × 50 − 5 000 = 500 ; panier ensuite : 6 600 − 5 500 = 1 100.
    expect(parId.get("clients")?.contributionParent).toBe(500);
    expect(parId.get("panier")?.contributionParent).toBe(1100);
    expect(parId.get("clients")?.contributionRacineExacte).toBe("500");
    expect(parId.get("panier")?.partParent).toBe(0.6875);
  });

  it("l'ordre des rangs fixe la décomposition", () => {
    const inverse = decomposerArbreKpi(
      [
        n("ca", null, { relation: "produit" }),
        n("clients", "ca", { rang: 2, avant: 100, apres: 110 }),
        n("panier", "ca", { rang: 1, avant: 50, apres: 60 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    const parId = new Map(inverse.noeuds.map((x) => [x.id, x]));
    expect(parId.get("panier")?.contributionParent).toBe(1000);
    expect(parId.get("clients")?.contributionParent).toBe(600);
  });

  it("produit sous une somme : propagation au prorata, somme exacte à la racine", () => {
    const r = decomposerArbreKpi(
      [
        n("total", null),
        n("ca", "total", { rang: 1, relation: "produit" }),
        n("autres", "total", { rang: 2, avant: 7, apres: 3 }),
        n("clients", "ca", { rang: 1, avant: 3, apres: 4 }),
        n("panier", "ca", { rang: 2, avant: 7, apres: 9 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    // ca : 21 -> 36 (+15) ; autres : -4 ; total : 28 -> 39 (+11).
    expect(r.variationRacine).toBe(11);
    const parId = new Map(r.noeuds.map((x) => [x.id, x]));
    expect(parId.get("ca")?.contributionParent).toBe(15);
    const somme = r.leviers.reduce((s, l) => s + l.contributionRacine, 0);
    expect(somme).toBe(11);
    expect(parId.get("clients")?.contributionRacineExacte).toBe("7");
    expect(parId.get("panier")?.contributionRacineExacte).toBe("8");
  });

  it("refuse un coefficient différent de 1 sous un produit", () => {
    expect(
      codeErreur(() =>
        decomposerArbreKpi(
          [
            n("ca", null, { relation: "produit" }),
            n("a", "ca", { coefficient: 2, avant: 1, apres: 1 }),
          ],
          { sens: "plus_haut_mieux" },
        ),
      ),
    ).toBe("ARBRE_INVALIDE");
  });
});

describe("arbre d'indicateurs : données incomplètes et arbres invalides", () => {
  it("un levier sans valeur rend l'arbre non évaluable et le signale", () => {
    const r = decomposerArbreKpi(
      [
        n("r", null),
        n("a", "r", { rang: 1, avant: 10, apres: 12 }),
        n("b", "r", { rang: 2, avant: null, apres: 5 }),
      ],
      { sens: "plus_haut_mieux" },
    );
    expect(r.evaluable).toBe(false);
    expect(r.manquants).toEqual(["b"]);
    expect(r.variationRacine).toBeNull();
    expect(r.leviers).toEqual([]);
    expect(r.noeuds.find((x) => x.id === "r")?.evaluable).toBe(false);
  });

  it("une racine seule se décrit par sa propre variation", () => {
    const r = decomposerArbreKpi([n("r", null, { avant: 10, apres: 15 })], {
      sens: "plus_bas_mieux",
    });
    expect(r.evaluable).toBe(true);
    expect(r.variationRacine).toBe(5);
    expect(r.leviers).toEqual([]);
  });

  it("refuse un arbre incohérent", () => {
    const o = { sens: "plus_haut_mieux" } as const;
    expect(codeErreur(() => decomposerArbreKpi([], o))).toBe("ARBRE_INVALIDE");
    expect(codeErreur(() => decomposerArbreKpi([n("a", null), n("b", null)], o))).toBe(
      "ARBRE_INVALIDE",
    );
    expect(codeErreur(() => decomposerArbreKpi([n("a", null), n("a", "a")], o))).toBe(
      "ARBRE_INVALIDE",
    );
    expect(codeErreur(() => decomposerArbreKpi([n("a", null), n("b", "inconnu")], o))).toBe(
      "ARBRE_INVALIDE",
    );
    expect(codeErreur(() => decomposerArbreKpi([n("a", null), n("b", "b")], o))).toBe(
      "ARBRE_INVALIDE",
    );
    // Cycle isolé de la racine.
    expect(codeErreur(() => decomposerArbreKpi([n("a", null), n("b", "c"), n("c", "b")], o))).toBe(
      "ARBRE_INVALIDE",
    );
    expect(
      codeErreur(() => decomposerArbreKpi([n("a", null), n("b", "a", { rang: 1.5 })], o)),
    ).toBe("ARBRE_INVALIDE");
    expect(codeErreur(() => decomposerArbreKpi([n("a", null, { avant: Number.NaN })], o))).toBe(
      "NOMBRE_INVALIDE",
    );
    expect(codeErreur(() => decomposerArbreKpi([n("a", null)], { sens: "bizarre" as never }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });

  it("borne le nombre de nœuds et la profondeur", () => {
    const o = { sens: "plus_haut_mieux" } as const;
    const large = [
      n("r", null),
      ...Array.from({ length: MAX_NOEUDS_ARBRE_KPI }, (_, i) => n(`f${i}`, "r", { rang: i })),
    ];
    expect(codeErreur(() => decomposerArbreKpi(large, o))).toBe("ARBRE_INVALIDE");
    const chaine = [n("n0", null)];
    for (let i = 1; i <= 7; i++) chaine.push(n(`n${i}`, `n${i - 1}`));
    expect(codeErreur(() => decomposerArbreKpi(chaine, o))).toBe("ARBRE_INVALIDE");
    expect(codeErreur(() => decomposerArbreKpi(chaine.slice(0, 7), o))).toBeUndefined();
  });

  it("départage les frères de même rang par identifiant", () => {
    const r = decomposerArbreKpi(
      [n("r", null), n("b", "r", { avant: 1, apres: 3 }), n("a", "r", { avant: 1, apres: 3 })],
      { sens: "plus_haut_mieux" },
    );
    expect(r.leviers.map((l) => l.id)).toEqual(["a", "b"]);
    expect(r.noeuds.map((x) => x.id)).toEqual(["r", "a", "b"]);
  });
});
