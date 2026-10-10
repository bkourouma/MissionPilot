import { describe, expect, it } from "vitest";
import { ErreurPlan } from "./erreurs";
import { optimiserPortefeuille, scorerInitiative, type CandidatPortefeuille } from "./portefeuille";

const c = (
  id: string,
  valeur: number,
  cout: number,
  extra: Partial<CandidatPortefeuille> = {},
): CandidatPortefeuille => ({ id, valeur, effort: 3, risque: 3, cout, charge: 0, ...extra });

describe("scorerInitiative", () => {
  it("vaut 100 pour la meilleure note, 0 pour la pire", () => {
    expect(scorerInitiative({ valeur: 5, effort: 1, risque: 1 })).toBe(100);
    expect(scorerInitiative({ valeur: 1, effort: 5, risque: 5 })).toBe(0);
    // 5×2 + 3×2 + 2×2 = 20 points sur 40.
    expect(scorerInitiative({ valeur: 3, effort: 3, risque: 3 })).toBe(50);
    expect(
      scorerInitiative({ valeur: 5, effort: 5, risque: 5 }, { valeur: 1, effort: 0, risque: 0 }),
    ).toBe(100);
  });

  it("refuse une note ou un poids hors bornes", () => {
    expect(() => scorerInitiative({ valeur: 6, effort: 1, risque: 1 })).toThrow(ErreurPlan);
    expect(() => scorerInitiative({ valeur: 3, effort: 0, risque: 1 })).toThrow(/Notes/);
    expect(() =>
      scorerInitiative({ valeur: 3, effort: 3, risque: 3 }, { valeur: 11, effort: 0, risque: 0 }),
    ).toThrow(/Poids/);
    expect(() =>
      scorerInitiative({ valeur: 3, effort: 3, risque: 3 }, { valeur: 0, effort: 0, risque: 0 }),
    ).toThrow(/non nul/);
  });
});

describe("optimiserPortefeuille", () => {
  it("trouve l'optimum exact du sac à dos (et non la solution gloutonne)", () => {
    // Scores : a 75, b 63, c 63 (valeur 5, 4, 4). Glouton par score : a seul (budget 10).
    const r = optimiserPortefeuille([c("a", 5, 6), c("b", 4, 5), c("c", 4, 5)], {
      budgetMax: 10,
      capaciteMax: null,
    });
    expect(r.decisions.map((d) => d.score)).toEqual([75, 63, 63]);
    expect(r.retenues).toEqual(["b", "c"]);
    expect(r.totaux).toEqual({ score: 126, cout: 10, charge: 0 });
    expect(r.optimal).toBe(true);
    expect(r.realisable).toBe(true);
    expect(r.decisions.find((d) => d.id === "a")?.motif).toBe("contraintes");
  });

  it("respecte la capacité en jours-homme", () => {
    const r = optimiserPortefeuille(
      [c("a", 5, 0, { charge: 30 }), c("b", 4, 0, { charge: 20 }), c("c", 2, 0, { charge: 10 })],
      { budgetMax: null, capaciteMax: 40 },
    );
    expect(r.retenues).toEqual(["a", "c"]);
    expect(r.totaux.charge).toBe(40);
  });

  it("retient les obligatoires et leurs prérequis, écarte les exclues et leurs dépendantes", () => {
    const r = optimiserPortefeuille(
      [
        c("a", 1, 1, { obligatoire: true, dependances: ["b", "hors-portefeuille"] }),
        c("b", 2, 1),
        c("x", 5, 1, { exclue: true }),
        c("y", 5, 1, { dependances: ["x"] }),
        c("z", 1, 1, { effort: 5, risque: 5 }),
        c("w", 4, 50),
      ],
      { budgetMax: 10, capaciteMax: null },
    );
    expect(r.decisions.map((d) => [d.id, d.retenue, d.motif])).toEqual([
      ["a", true, "obligatoire"],
      ["b", true, "obligatoire"],
      ["x", false, "exclue"],
      ["y", false, "depend_d_une_exclue"],
      ["z", false, "score_nul"],
      ["w", false, "contraintes"],
    ]);
  });

  it("une initiative retenue entraîne ses prérequis, même de score nul", () => {
    const r = optimiserPortefeuille(
      [c("p", 1, 2, { effort: 5, risque: 5 }), c("q", 5, 2, { dependances: ["p"] }), c("r", 4, 3)],
      { budgetMax: 5, capaciteMax: null },
    );
    expect(r.retenues).toEqual(["p", "q"]);
    const r2 = optimiserPortefeuille(
      [c("p", 1, 2, { effort: 5, risque: 5 }), c("q", 5, 2, { dependances: ["p"] }), c("r", 4, 3)],
      { budgetMax: 3, capaciteMax: null },
    );
    expect(r2.retenues).toEqual(["r"]);
  });

  it("signale un portefeuille irréalisable (obligatoires hors budget ou dépendant d'une exclue)", () => {
    const r = optimiserPortefeuille([c("a", 5, 20, { obligatoire: true }), c("b", 5, 1)], {
      budgetMax: 10,
      capaciteMax: null,
    });
    expect(r.realisable).toBe(false);
    expect(r.retenues).toEqual(["a"]);
    const r2 = optimiserPortefeuille(
      [c("a", 5, 1, { obligatoire: true, dependances: ["b"] }), c("b", 5, 1, { exclue: true })],
      { budgetMax: null, capaciteMax: null },
    );
    expect(r2.realisable).toBe(false);
    expect(r2.retenues).toEqual([]);
    const r3 = optimiserPortefeuille([c("a", 5, 1, { obligatoire: true, charge: 9 })], {
      budgetMax: null,
      capaciteMax: 5,
    });
    expect(r3.realisable).toBe(false);
  });

  it("est déterministe et coupe la recherche au-delà du plafond de nœuds", () => {
    const candidats = Array.from({ length: 24 }, (_, i) =>
      c(`i${String(i).padStart(2, "0")}`, 1 + (i % 5), 3 + ((i * 7) % 11), { charge: i % 4 }),
    );
    const contraintes = {
      budgetMax: 40,
      capaciteMax: 20,
      poids: { valeur: 4, effort: 3, risque: 3 },
    };
    const r1 = optimiserPortefeuille(candidats, contraintes);
    const r2 = optimiserPortefeuille(candidats, contraintes);
    expect(r1).toEqual(r2);
    expect(r1.totaux.cout).toBeLessThanOrEqual(40);
    expect(r1.totaux.charge).toBeLessThanOrEqual(20);
    const coupe = optimiserPortefeuille(candidats, contraintes, 5);
    expect(coupe.optimal).toBe(false);
    expect(coupe.noeudsExplores).toBe(6);
    expect(coupe.totaux.score).toBeLessThanOrEqual(r1.totaux.score);
  });

  it("refuse des entrées invalides", () => {
    const sans = { budgetMax: null, capaciteMax: null };
    expect(() => optimiserPortefeuille([c("a", 3, 1), c("a", 3, 1)], sans)).toThrow(/double/);
    expect(() => optimiserPortefeuille([c("a", 3, -1)], sans)).toThrow(/Coût/);
    expect(() => optimiserPortefeuille([c("a", 3, 1, { charge: 0.5 })], sans)).toThrow(/Coût/);
    expect(() => optimiserPortefeuille([], { budgetMax: -1, capaciteMax: null })).toThrow(
      /Contrainte/,
    );
    expect(() =>
      optimiserPortefeuille(
        Array.from({ length: 301 }, (_, i) => c(String(i), 3, 1)),
        sans,
      ),
    ).toThrow(/Trop/);
    for (const noeudsMax of [0, -1, 1.5, Number.NaN]) {
      expect(() => optimiserPortefeuille([c("a", 3, 1)], sans, noeudsMax)).toThrow(
        expect.objectContaining({ code: "PORTEFEUILLE_INVALIDE" }),
      );
    }
  });
});
