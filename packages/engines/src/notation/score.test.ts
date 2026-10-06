import { describe, expect, it } from "vitest";
import { BAREME_CLASSES, classe, rangClasse } from "./classes";
import { pointsExacts, scoreQuestion } from "./conversion";
import { GRILLE, REPONSES_EXEMPLE } from "./fixtures.test-utils";
import type { DimensionGrille, RegleConversion } from "./grille";
import { noterDepuisPoints, scoreDimension, scoreGlobal } from "./score";

const erreur = (code: string) => expect.objectContaining({ code });
const dimension = (id: string) => GRILLE.dimensions.find((d) => d.id === id) as DimensionGrille;

describe("classe (NOT-03) : A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, E < 35", () => {
  it.each([
    [100, "A"],
    [80, "A"],
    [79.9, "B"],
    [65, "B"],
    [64.9, "C"],
    [50, "C"],
    [49.9, "D"],
    [35, "D"],
    [34.9, "E"],
    [0, "E"],
  ] as const)("%d → %s", (score, attendue) => {
    expect(classe(score)).toBe(attendue);
  });

  it("refuse un score hors de l'échelle", () => {
    for (const s of [-0.1, 100.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => classe(s)).toThrow(erreur("SCORE_INVALIDE"));
    }
  });

  it("ordonne les classes", () => {
    expect(BAREME_CLASSES.map((b) => rangClasse(b.classe))).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("scoreQuestion : conversion d'une réponse en points", () => {
  const likert5: RegleConversion = { type: "likert", points: 5 };
  it.each([
    [1, 0],
    [2, 25],
    [3, 50],
    [4, 75],
    [5, 100],
  ])("Likert 5 niveaux : %d → %d points", (v, p) => {
    expect(scoreQuestion(likert5, v)).toBe(p);
  });

  it("Likert inversé et échelles impaires exactes", () => {
    expect(scoreQuestion({ type: "likert", points: 5, inverse: true }, 1)).toBe(100);
    expect(scoreQuestion({ type: "likert", points: 5, inverse: true }, 5)).toBe(0);
    expect(scoreQuestion({ type: "likert", points: 4 }, 2)).toBe(33.3);
    expect(pointsExacts({ type: "likert", points: 4 }, 2)).toEqual({ num: 100n, den: 3n });
  });

  it("choix, choix multiple plafonné, oui/non", () => {
    const choix: RegleConversion = {
      type: "choix",
      valeurs: [
        { code: "a", points: 70 },
        { code: "b", points: 12.5 },
      ],
    };
    expect(scoreQuestion(choix, "b")).toBe(12.5);
    const multiple: RegleConversion = {
      type: "choix_multiple",
      valeurs: [
        { code: "a", points: 60 },
        { code: "b", points: 30 },
        { code: "c", points: 30 },
      ],
    };
    expect(scoreQuestion(multiple, ["a", "b"])).toBe(90);
    expect(scoreQuestion(multiple, ["a", "b", "c"])).toBe(100);
    expect(scoreQuestion(multiple, ["b", "b"])).toBe(30);
    expect(scoreQuestion({ type: "oui_non", oui: 80, non: 10 }, true)).toBe(80);
    expect(scoreQuestion({ type: "oui_non", oui: 80, non: 10 }, false)).toBe(10);
  });

  it("seuils : dernier palier atteint, premier palier en dessous", () => {
    const seuils = dimension("couts").indicateurs[0]!.conversion;
    expect([-5, 0, 9.99, 10, 19.9, 20, 1000].map((v) => scoreQuestion(seuils, v))).toEqual([
      0, 0, 0, 50, 50, 100, 100,
    ]);
  });

  it("interpolation linéaire bornée aux extrémités", () => {
    const interp: RegleConversion = {
      type: "interpolation",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 50 },
        { x: 40, y: 80 },
      ],
    };
    expect([-1, 0, 5, 10, 25, 40, 99].map((v) => scoreQuestion(interp, v))).toEqual([
      0, 0, 25, 50, 65, 80, 80,
    ]);
    expect(pointsExacts(interp, 0.1)).toEqual({ num: 1n, den: 2n });
  });

  it("une réponse vide n'a pas de points", () => {
    expect(scoreQuestion(likert5, null)).toBeNull();
    expect(scoreQuestion(likert5, undefined)).toBeNull();
    expect(
      scoreQuestion({ type: "choix_multiple", valeurs: [{ code: "a", points: 1 }] }, []),
    ).toBeNull();
  });

  it.each<[RegleConversion, unknown]>([
    [{ type: "likert", points: 5 }, 6],
    [{ type: "likert", points: 5 }, 0],
    [{ type: "likert", points: 5 }, 2.5],
    [{ type: "likert", points: 5 }, "3"],
    [{ type: "choix", valeurs: [{ code: "a", points: 1 }] }, "z"],
    [{ type: "choix_multiple", valeurs: [{ code: "a", points: 1 }] }, "a"],
    [{ type: "choix_multiple", valeurs: [{ code: "a", points: 1 }] }, ["a", "z"]],
    [{ type: "oui_non", oui: 1, non: 0 }, "oui"],
    [{ type: "seuils", paliers: [{ min: 0, points: 0 }] }, "12"],
    [
      {
        type: "interpolation",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      true,
    ],
  ])("refuse une réponse incompatible (%j, %j)", (regle, valeur) => {
    expect(() => scoreQuestion(regle, valeur as never)).toThrow(erreur("REPONSE_INCOMPATIBLE"));
  });
});

/*
 * EXEMPLE CHIFFRÉ COMPLET, calculé à la main (grille d'essai, fixtures) :
 *
 * Réponses : q1 = 3, q2 = « b », q3 = oui, q4 = 15, q5 = 20, q6 = 2.
 *
 * Stratégie (poids 60) — indicateurs pondérés 2, 1, 1 :
 *   i1 Likert 3/5         → (3 − 1) / 4 × 100 = 50
 *   i2 choix « b »        → 50
 *   i3 oui                → 100
 *   score = (2 × 50 + 1 × 50 + 1 × 100) / 4 = 250 / 4 = 62,5  → C
 *
 * Coûts (poids 40) — indicateurs pondérés 1, 1, 2 :
 *   i4 seuils, 15         → palier « ≥ 10 » = 50
 *   i5 interpolation, 20  → 100 + (20 − 0) × (0 − 100) / 50 = 60
 *   i6 Likert inversé, 2  → (5 − 2) / 4 × 100 = 75
 *   score = (50 + 60 + 2 × 75) / 4 = 260 / 4 = 65  → B (borne exacte)
 *
 * Global, poids par défaut 60/40 :
 *   (60 × 62,5 + 40 × 65) / 100 = (3 750 + 2 600) / 100 = 63,5  → C
 * Secteur « industrie » (coûts surchargé à 60 → 50/50) :
 *   (62,5 + 65) / 2 = 63,75 → arrondi 63,8 (demi s'éloignant de zéro) → C
 * Secteur « numérique » (1 et 2 → 33,33/66,67 exacts 100/3 et 200/3) :
 *   (62,5 + 2 × 65) / 3 = 192,5 / 3 = 64,1666… → 64,2 → C ; exact 385/6
 *
 * Réponse q2 manquante, stratégie « ignorer » :
 *   (2 × 50 + 100) / 3 = 66,666… → 66,7 (couverture 3/4 = 0,75)
 * Réponse q2 manquante, stratégie « pénaliser » :
 *   (2 × 50 + 0 + 100) / 4 = 50
 */
describe("exemple chiffré complet (calculé à la main ci-dessus)", () => {
  it("reproduit les scores par dimension et le score global", () => {
    const r = scoreGlobal(GRILLE, REPONSES_EXEMPLE);
    expect(r).toMatchObject({
      grille: "essai",
      version: 1,
      secteur: null,
      strategie: "ignorer",
      notable: true,
      score: 63.5,
      scoreExact: "127/2",
      classe: "C",
      couverture: 1,
    });
    expect(r.dimensions).toEqual([
      {
        dimension: "strategie",
        libelle: "Stratégie",
        famille: "excellence",
        notable: true,
        score: 62.5,
        scoreExact: "125/2",
        classe: "C",
        couverture: 1,
        poids: 60,
        poidsExact: "60",
        indicateurs: [
          { indicateur: "i1", question: "q1", statut: "repondu", points: 50 },
          { indicateur: "i2", question: "q2", statut: "repondu", points: 50 },
          { indicateur: "i3", question: "q3", statut: "repondu", points: 100 },
        ],
      },
      {
        dimension: "couts",
        libelle: "Coûts",
        famille: "competitivite",
        notable: true,
        score: 65,
        scoreExact: "65",
        classe: "B",
        couverture: 1,
        poids: 40,
        poidsExact: "40",
        indicateurs: [
          { indicateur: "i4", question: "q4", statut: "repondu", points: 50 },
          { indicateur: "i5", question: "q5", statut: "repondu", points: 60 },
          { indicateur: "i6", question: "q6", statut: "repondu", points: 75 },
        ],
      },
    ]);
  });

  it("applique les pondérations sectorielles", () => {
    expect(scoreGlobal(GRILLE, REPONSES_EXEMPLE, { secteur: "industrie" })).toMatchObject({
      secteur: "industrie",
      score: 63.8,
      scoreExact: "255/4",
      classe: "C",
    });
    const numerique = scoreGlobal(GRILLE, REPONSES_EXEMPLE, { secteur: "numerique" });
    expect(numerique).toMatchObject({ score: 64.2, scoreExact: "385/6", classe: "C" });
    expect(numerique.dimensions.map((d) => [d.poids, d.poidsExact])).toEqual([
      [33.33, "100/3"],
      [66.67, "200/3"],
    ]);
  });

  it("réponse manquante : ignorer et renormaliser, ou pénaliser", () => {
    const sansQ2 = { ...REPONSES_EXEMPLE, q2: null };
    const ignorer = scoreDimension(dimension("strategie"), sansQ2);
    expect(ignorer).toMatchObject({
      score: 66.7,
      scoreExact: "200/3",
      couverture: 0.75,
      notable: true,
      classe: "B",
    });
    expect(ignorer.indicateurs[1]).toEqual({
      indicateur: "i2",
      question: "q2",
      statut: "manquant",
      points: null,
    });
    expect(
      scoreDimension(dimension("strategie"), sansQ2, { strategie: "penaliser" }),
    ).toMatchObject({
      score: 50,
      couverture: 0.75,
    });
  });
});

describe("couverture et cas limites", () => {
  it("aucune réponse : rien n'est notable", () => {
    const r = scoreGlobal(GRILLE, {});
    expect(r).toMatchObject({
      notable: false,
      score: null,
      scoreExact: null,
      classe: null,
      couverture: 0,
    });
    expect(r.dimensions.every((d) => !d.notable && d.score === null && d.classe === null)).toBe(
      true,
    );
    // Même avec la stratégie « pénaliser » et une couverture minimale nulle.
    const p = scoreGlobal(
      GRILLE,
      {},
      { strategie: "penaliser", couvertureMinimale: 0, couvertureGlobaleMinimale: 0 },
    );
    expect(p.score).toBeNull();
  });

  it("couverture insuffisante : la dimension n'est pas notable", () => {
    // Seule q3 (poids 1 sur 4) : couverture 0,25 < 0,5.
    const d = scoreDimension(dimension("strategie"), { q3: true });
    expect(d).toMatchObject({ notable: false, score: null, couverture: 0.25 });
    expect(
      scoreDimension(dimension("strategie"), { q3: true }, { couvertureMinimale: 0.25 }),
    ).toMatchObject({
      notable: true,
      score: 100,
    });
    // Borne exacte : couverture 0,5 = seuil 0,5 → notable.
    expect(scoreDimension(dimension("strategie"), { q1: 5 }).notable).toBe(true);
  });

  it("une seule dimension notable : le global dépend du seuil de couverture globale", () => {
    const reponses = { q4: 15, q5: 20, q6: 2 }; // coûts seuls (poids 40 %)
    const defaut = scoreGlobal(GRILLE, reponses);
    expect(defaut).toMatchObject({ notable: false, score: null, couverture: 0.4 });
    const tolerant = scoreGlobal(GRILLE, reponses, { couvertureGlobaleMinimale: 0.4 });
    expect(tolerant).toMatchObject({ notable: true, score: 65, classe: "B" });
    // Pénaliser : la dimension non notable compte pour 0 → 40 × 65 / 100 = 26.
    const penalise = scoreGlobal(GRILLE, reponses, {
      strategie: "penaliser",
      couvertureGlobaleMinimale: 0.4,
    });
    expect(penalise).toMatchObject({ score: 26, classe: "E" });
  });

  it("indicateur sans objet : hors du calcul et de la couverture", () => {
    const r = scoreDimension(
      dimension("strategie"),
      { q1: 3, q3: true },
      { nonApplicables: ["q2"] },
    );
    expect(r).toMatchObject({ score: 66.7, couverture: 1 });
    expect(r.indicateurs[1]?.statut).toBe("sans_objet");
    const toutSansObjet = scoreDimension(
      dimension("strategie"),
      {},
      { nonApplicables: ["q1", "q2", "q3"] },
    );
    expect(toutSansObjet).toMatchObject({ notable: false, couverture: 0 });
  });

  it("une dimension de poids nul est calculée mais ne pèse pas", () => {
    const g = {
      ...GRILLE,
      secteurs: [{ secteur: "s", poids: [{ dimension: "couts", poids: 0 }] }],
    };
    const r = scoreGlobal(g, REPONSES_EXEMPLE, { secteur: "s" });
    expect(r).toMatchObject({ score: 62.5, couverture: 1 });
    expect(r.dimensions[1]).toMatchObject({ score: 65, poids: 0 });
  });

  it("noterDepuisPoints traite un indicateur absent comme manquant", () => {
    expect(noterDepuisPoints(GRILLE, new Map()).score).toBeNull();
  });

  it("refuse des options invalides", () => {
    expect(() => scoreGlobal(GRILLE, {}, { strategie: "autre" as never })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() => scoreGlobal(GRILLE, {}, { couvertureMinimale: 1.1 })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() => scoreGlobal(GRILLE, {}, { couvertureGlobaleMinimale: -0.1 })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() => scoreGlobal(GRILLE, {}, { couvertureMinimale: Number.NaN })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
  });

  it("refuse une grille invalide et une réponse incompatible", () => {
    expect(() => scoreGlobal({ ...GRILLE, dimensions: [] }, {})).toThrow(erreur("GRILLE_INVALIDE"));
    expect(() => scoreDimension({ ...dimension("couts"), indicateurs: [] }, {})).toThrow(
      erreur("GRILLE_INVALIDE"),
    );
    expect(() => scoreGlobal(GRILLE, { q1: 9 })).toThrow(erreur("REPONSE_INCOMPATIBLE"));
  });

  it("borne haute et basse : toutes les réponses au mieux → 100, au pire → 0", () => {
    const max = scoreGlobal(GRILLE, { q1: 5, q2: "a", q3: true, q4: 20, q5: 0, q6: 1 });
    expect(max).toMatchObject({ score: 100, classe: "A" });
    const min = scoreGlobal(GRILLE, { q1: 1, q2: "c", q3: false, q4: 0, q5: 50, q6: 5 });
    expect(min).toMatchObject({ score: 0, classe: "E" });
  });
});
