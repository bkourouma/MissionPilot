import { describe, expect, it } from "vitest";
import { appliquerAjustement } from "./ajustement";
import { GRILLE, REPONSES_EXEMPLE } from "./fixtures.test-utils";
import {
  SEUIL_FAIBLESSE_DEFAUT,
  SEUIL_FORCE_DEFAUT,
  comparerNotations,
  donneesRapport,
  forcesEtFaiblesses,
  type VueScores,
} from "./rapport";
import { scoreGlobal } from "./score";

const vue = (scores: (number | null)[], famille?: (string | undefined)[]): VueScores => ({
  score: 50,
  classe: "C",
  dimensions: scores.map((score, i) => ({
    dimension: `d${i}`,
    libelle: `Dimension ${i}`,
    ...(famille?.[i] === undefined ? {} : { famille: famille[i] }),
    score,
  })),
});

describe("comparerNotations (NOT-08, partie calcul)", () => {
  it("compare entrée et sortie de mission, global et dimensions", () => {
    const entree = scoreGlobal(GRILLE, REPONSES_EXEMPLE); // 63,5 C
    const sortie = scoreGlobal(GRILLE, { ...REPONSES_EXEMPLE, q1: 5, q6: 1 }); // stratégie 87,5 ; coûts 77,5
    const c = comparerNotations(entree, sortie);
    expect(c.global).toEqual({ avant: 63.5, apres: 83.5, ecart: 20, evolution: "hausse" });
    expect(c).toMatchObject({ classeAvant: "C", classeApres: "A", ecartClasses: 2 });
    expect(c.dimensions).toEqual([
      {
        dimension: "strategie",
        libelle: "Stratégie",
        avant: 62.5,
        apres: 87.5,
        ecart: 25,
        evolution: "hausse",
      },
      {
        dimension: "couts",
        libelle: "Coûts",
        avant: 65,
        apres: 77.5,
        ecart: 12.5,
        evolution: "hausse",
      },
    ]);
    expect(comparerNotations(sortie, entree).global).toMatchObject({
      ecart: -20,
      evolution: "baisse",
    });
  });

  it("accepte un score ajusté et calcule des écarts exacts", () => {
    const calcule = scoreGlobal(GRILLE, REPONSES_EXEMPLE);
    const ajuste = appliquerAjustement(calcule, {
      dimension: "couts",
      delta: 0.1,
      motif: "Entretien",
      auteur: "c1",
      date: "2026-10-06",
    });
    const c = comparerNotations(calcule, ajuste);
    expect(c.dimensions[1]).toMatchObject({
      avant: 65,
      apres: 65.1,
      ecart: 0.1,
      evolution: "hausse",
    });
    expect(c.dimensions[0]).toMatchObject({ ecart: 0, evolution: "stable" });
    expect(c.global).toMatchObject({ avant: 63.5, apres: 63.5, evolution: "stable" });
  });

  it("apparie les dimensions par identifiant et signale les non comparables", () => {
    const avant: VueScores = {
      score: null,
      classe: null,
      dimensions: [
        { dimension: "a", libelle: "A", score: 40 },
        { dimension: "ancienne", libelle: "Ancienne", score: 10 },
      ],
    };
    const apres: VueScores = {
      score: 70,
      classe: "B",
      dimensions: [
        { dimension: "nouvelle", libelle: "Nouvelle", score: 50 },
        { dimension: "a", libelle: "A", score: null },
      ],
    };
    const c = comparerNotations(avant, apres);
    expect(c.global).toEqual({ avant: null, apres: 70, ecart: null, evolution: "non_comparable" });
    expect(c.ecartClasses).toBeNull();
    expect(c.dimensions.map((d) => [d.dimension, d.evolution])).toEqual([
      ["nouvelle", "non_comparable"],
      ["a", "non_comparable"],
      ["ancienne", "non_comparable"],
    ]);
    expect(c.dimensions[2]?.libelle).toBe("Ancienne");
  });
});

describe("forcesEtFaiblesses", () => {
  it("classe forces (≥ 65) et faiblesses (< 50) par défaut, ordre stable", () => {
    expect([SEUIL_FORCE_DEFAUT, SEUIL_FAIBLESSE_DEFAUT]).toEqual([65, 50]);
    const r = forcesEtFaiblesses(vue([65, 49.9, 90, null, 50, 64.9, 90, 10, 49.9]));
    expect(r.forces.map((d) => [d.dimension, d.score])).toEqual([
      ["d2", 90],
      ["d6", 90],
      ["d0", 65],
    ]);
    expect(r.faiblesses.map((d) => [d.dimension, d.score])).toEqual([
      ["d7", 10],
      ["d1", 49.9],
      ["d8", 49.9],
    ]);
  });

  it("accepte des seuils configurés et refuse des seuils incohérents", () => {
    const r = forcesEtFaiblesses(vue([70, 40]), { seuilForce: 80, seuilFaiblesse: 45 });
    expect(r).toEqual({
      forces: [],
      faiblesses: [{ dimension: "d1", libelle: "Dimension 1", score: 40 }],
    });
    const erreur = expect.objectContaining({ code: "OPTIONS_INVALIDES" });
    expect(() => forcesEtFaiblesses(vue([]), { seuilForce: 40, seuilFaiblesse: 60 })).toThrow(
      erreur,
    );
    expect(() => forcesEtFaiblesses(vue([]), { seuilForce: 101 })).toThrow(erreur);
    expect(() => forcesEtFaiblesses(vue([]), { seuilFaiblesse: -1 })).toThrow(erreur);
  });
});

describe("donneesRapport (NOT-07) : structures pures pour le rendu", () => {
  it("rend radar, barres par famille, forces et faiblesses", () => {
    const r = donneesRapport(scoreGlobal(GRILLE, { ...REPONSES_EXEMPLE, q6: 5 }));
    // Coûts : (50 + 60 + 0) / 4 = 27,5 → E, faiblesse.
    expect(r.global).toEqual({ score: 48.5, classe: "D" });
    expect(r.radar).toEqual([
      { dimension: "strategie", axe: "Stratégie", score: 62.5 },
      { dimension: "couts", axe: "Coûts", score: 27.5 },
    ]);
    expect(r.barres).toEqual([
      {
        famille: "excellence",
        dimensions: [{ dimension: "strategie", libelle: "Stratégie", score: 62.5, classe: "C" }],
      },
      {
        famille: "competitivite",
        dimensions: [{ dimension: "couts", libelle: "Coûts", score: 27.5, classe: "E" }],
      },
    ]);
    expect(r.forces).toEqual([]);
    expect(r.faiblesses).toEqual([{ dimension: "couts", libelle: "Coûts", score: 27.5 }]);
  });

  it("regroupe par famille dans l'ordre de première apparition, sans famille à part", () => {
    const r = donneesRapport(vue([80, null, 30], ["x", undefined, "x"]));
    expect(r.barres).toEqual([
      {
        famille: "x",
        dimensions: [
          { dimension: "d0", libelle: "Dimension 0", score: 80, classe: "A" },
          { dimension: "d2", libelle: "Dimension 2", score: 30, classe: "E" },
        ],
      },
      {
        famille: "",
        dimensions: [{ dimension: "d1", libelle: "Dimension 1", score: null, classe: null }],
      },
    ]);
  });
});
