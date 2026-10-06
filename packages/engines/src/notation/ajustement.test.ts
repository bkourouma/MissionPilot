import { describe, expect, it } from "vitest";
import { appliquerAjustement, initialiserAjustements, type Ajustement } from "./ajustement";
import { GRILLE, REPONSES_EXEMPLE } from "./fixtures.test-utils";
import { scoreGlobal } from "./score";

const erreur = (code: string) => expect.objectContaining({ code });

const ajustement = (dimension: string, delta: number, date = "2026-10-06"): Ajustement => ({
  dimension,
  delta,
  motif: "Visite terrain : tableaux de bord affichés et tenus à jour.",
  auteur: "consultant-1",
  date,
});

describe("appliquerAjustement (NOT-04) : motivé, tracé, plafonné", () => {
  const calcule = scoreGlobal(GRILLE, REPONSES_EXEMPLE); // stratégie 62,5 ; coûts 65 ; global 63,5

  it("ajuste une dimension et recalcule le global, sans toucher au calcul initial", () => {
    const avant = JSON.stringify(calcule);
    const s = appliquerAjustement(calcule, ajustement("strategie", 5));
    // Stratégie 67,5 → global (60 × 67,5 + 40 × 65) / 100 = 66,5.
    expect(s.dimensions[0]).toEqual({
      dimension: "strategie",
      libelle: "Stratégie",
      famille: "excellence",
      scoreCalcule: 62.5,
      score: 67.5,
      classe: "B",
      deltaCumule: 5,
    });
    expect(s).toMatchObject({ scoreCalcule: 63.5, score: 66.5, classe: "B", notable: true });
    expect(s.ajustements).toEqual([
      {
        ...ajustement("strategie", 5),
        rang: 1,
        scoreAvant: 62.5,
        scoreApres: 67.5,
        plafonne: false,
      },
    ]);
    expect(JSON.stringify(calcule)).toBe(avant);
    expect(s.calcule).toEqual(calcule);
    expect(s.calcule).not.toBe(calcule);
  });

  it("produit un historique immuable : chaque appel rend un nouvel état figé", () => {
    const s1 = appliquerAjustement(calcule, ajustement("strategie", 5));
    const s2 = appliquerAjustement(s1, ajustement("couts", -2.5, "2026-10-07"));
    expect(s1.ajustements).toHaveLength(1);
    expect(s2.ajustements.map((a) => a.rang)).toEqual([1, 2]);
    expect(s2.dimensions.map((d) => d.score)).toEqual([67.5, 62.5]);
    // (60 × 67,5 + 40 × 62,5) / 100 = 65,5.
    expect(s2.score).toBe(65.5);
    for (const o of [
      s2,
      s2.ajustements,
      s2.ajustements[0],
      s2.dimensions,
      s2.calcule,
      s2.calcule.dimensions,
    ]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
    expect(() => (s2.ajustements as unknown as Ajustement[]).push(ajustement("couts", 1))).toThrow(
      TypeError,
    );
  });

  it("plafonne le cumul à [0, 100], quel que soit l'ordre des ajustements", () => {
    const haut = appliquerAjustement(calcule, ajustement("strategie", 50));
    expect(haut.dimensions[0]?.score).toBe(100);
    expect(haut.ajustements[0]).toMatchObject({
      scoreAvant: 62.5,
      scoreApres: 100,
      plafonne: true,
    });
    const retour = appliquerAjustement(haut, ajustement("strategie", -40));
    // Cumul + 10 : 72,5, le plafonnement porte sur le cumul et non pas à pas.
    expect(retour.dimensions[0]).toMatchObject({ score: 72.5, deltaCumule: 10 });
    expect(retour.ajustements[1]).toMatchObject({
      scoreAvant: 100,
      scoreApres: 72.5,
      plafonne: false,
    });
    const bas = appliquerAjustement(calcule, ajustement("couts", -100));
    expect(bas.dimensions[1]).toMatchObject({ score: 0, classe: "E" });
    expect(bas.ajustements[0]?.plafonne).toBe(true);
    const inverse = appliquerAjustement(
      appliquerAjustement(calcule, ajustement("strategie", -40)),
      ajustement("strategie", 50),
    );
    expect(inverse.dimensions[0]?.score).toBe(retour.dimensions[0]?.score);
  });

  it("initialiserAjustements rend les scores calculés", () => {
    const s = initialiserAjustements(calcule);
    expect(s).toMatchObject({ score: 63.5, classe: "C", ajustements: [] });
    expect(s.dimensions.map((d) => d.deltaCumule)).toEqual([0, 0]);
  });

  it("recalcule avec la stratégie « pénaliser » du calcul initial", () => {
    const penalise = scoreGlobal(
      GRILLE,
      { q4: 15, q5: 20, q6: 2 },
      { strategie: "penaliser", couvertureGlobaleMinimale: 0.4 },
    );
    const s = appliquerAjustement(penalise, ajustement("couts", 10));
    // 40 × 75 / 100 = 30.
    expect(s.score).toBe(30);
  });

  it("un global non notable reste non notable", () => {
    const partiel = scoreGlobal(GRILLE, { q4: 15, q5: 20, q6: 2 });
    const s = appliquerAjustement(partiel, ajustement("couts", 10));
    expect(s).toMatchObject({ notable: false, score: null, classe: null });
    expect(s.dimensions[1]?.score).toBe(75);
    expect(s.dimensions[0]).toMatchObject({ score: null, classe: null });
  });

  it("exige motif, auteur, date valide et chronologique, écart utile", () => {
    const cas: [Partial<Ajustement>, string][] = [
      [{ motif: "  " }, "AJUSTEMENT_INVALIDE"],
      [{ auteur: "" }, "AJUSTEMENT_INVALIDE"],
      [{ date: "2026-02-30" }, "AJUSTEMENT_INVALIDE"],
      [{ delta: 0 }, "AJUSTEMENT_INVALIDE"],
      [{ delta: 100.5 }, "AJUSTEMENT_INVALIDE"],
      [{ delta: Number.NaN }, "AJUSTEMENT_INVALIDE"],
      [{ delta: 1.25 }, "AJUSTEMENT_INVALIDE"],
      [{ dimension: "inconnue" }, "DIMENSION_INCONNUE"],
    ];
    for (const [modif, code] of cas) {
      expect(() =>
        appliquerAjustement(calcule, { ...ajustement("strategie", 5), ...modif }),
      ).toThrow(erreur(code));
    }
    const s = appliquerAjustement(calcule, ajustement("strategie", 5, "2026-10-10"));
    expect(() => appliquerAjustement(s, ajustement("strategie", 1, "2026-10-09"))).toThrow(
      erreur("AJUSTEMENT_INVALIDE"),
    );
    expect(
      appliquerAjustement(s, ajustement("strategie", -0.1, "2026-10-10")).dimensions[0]?.score,
    ).toBe(67.4);
  });

  it("refuse d'ajuster une dimension non notable", () => {
    const partiel = scoreGlobal(GRILLE, { q4: 15, q5: 20, q6: 2 });
    expect(() => appliquerAjustement(partiel, ajustement("strategie", 5))).toThrow(
      erreur("DIMENSION_NON_NOTABLE"),
    );
  });

  it("trace le motif sans espaces de bord", () => {
    const s = appliquerAjustement(calcule, {
      ...ajustement("couts", 1),
      motif: "  Entretien DG  ",
    });
    expect(s.ajustements[0]?.motif).toBe("Entretien DG");
  });
});
