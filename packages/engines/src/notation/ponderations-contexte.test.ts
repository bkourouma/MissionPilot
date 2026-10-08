import { describe, expect, it } from "vitest";
import { ErreurNotation } from "./erreurs";
import { GRILLE } from "./fixtures.test-utils";
import { poidsNormalises, type GrilleNotation } from "./grille";
import { appliquerPonderationsContexte } from "./ponderations-contexte";
import { scoreGlobal } from "./score";

const REPONSES = { q1: 4, q2: "b", q3: true, q4: 15, q5: 10, q6: 2 };

describe("appliquerPonderationsContexte (variante de contexte, ADR-004)", () => {
  it("sans pondération : la MÊME grille (identité), donc un résultat identique", () => {
    const r = appliquerPonderationsContexte(GRILLE, []);
    expect(r.grille).toBe(GRILLE);
    expect(r.appliquees).toEqual([]);
    expect(scoreGlobal(r.grille, REPONSES)).toEqual(scoreGlobal(GRILLE, REPONSES));
  });

  it("remplace le poids par défaut et celui des surcharges sectorielles qui nomment la dimension", () => {
    const r = appliquerPonderationsContexte(GRILLE, [{ dimension: "couts", poids: 10 }]);
    expect(r.appliquees).toEqual([
      { dimension: "couts", poidsAvant: 40, poidsApres: 10, secteurs: ["industrie", "numerique"] },
    ]);
    expect(r.grille.dimensions.find((d) => d.id === "couts")?.poids).toBe(10);
    expect(r.grille.dimensions.find((d) => d.id === "strategie")?.poids).toBe(60);
    expect(r.grille.secteurs?.[0]?.poids).toEqual([{ dimension: "couts", poids: 10 }]);
    expect(r.grille.secteurs?.[1]?.poids).toEqual([
      { dimension: "strategie", poids: 1 },
      { dimension: "couts", poids: 10 },
    ]);
    // La grille d'origine n'est pas modifiée.
    expect(GRILLE.dimensions.find((d) => d.id === "couts")?.poids).toBe(40);
    // Normalisation : la part de chaque dimension change, pas le score d'une dimension.
    expect(poidsNormalises(r.grille).poids).toEqual([
      { dimension: "strategie", poids: 85.71 },
      { dimension: "couts", poids: 14.29 },
    ]);
    const avant = scoreGlobal(GRILLE, REPONSES);
    const apres = scoreGlobal(r.grille, REPONSES);
    expect(apres.dimensions.map((d) => d.score)).toEqual(avant.dimensions.map((d) => d.score));
    expect(apres.score).not.toBe(avant.score);
    expect(scoreGlobal(r.grille, REPONSES, { secteur: "industrie" }).score).toBe(apres.score);
  });

  it("une grille sans secteur reste sans secteur", () => {
    const sansSecteur: GrilleNotation = { ...GRILLE };
    delete (sansSecteur as { secteurs?: unknown }).secteurs;
    const r = appliquerPonderationsContexte(sansSecteur, [{ dimension: "strategie", poids: 5 }]);
    expect(r.grille.secteurs).toBeUndefined();
    expect(r.appliquees[0]?.secteurs).toEqual([]);
  });

  it("refuse une dimension inconnue, un doublon, un poids invalide ou une grille sans poids", () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as ErreurNotation).code;
      }
      return null;
    };
    expect(code(() => appliquerPonderationsContexte(GRILLE, [{ dimension: "x", poids: 1 }]))).toBe(
      "DIMENSION_INCONNUE",
    );
    expect(
      code(() =>
        appliquerPonderationsContexte(GRILLE, [
          { dimension: "couts", poids: 1 },
          { dimension: "couts", poids: 2 },
        ]),
      ),
    ).toBe("OPTIONS_INVALIDES");
    for (const poids of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        code(() => appliquerPonderationsContexte(GRILLE, [{ dimension: "couts", poids }])),
      ).toBe("NOMBRE_INVALIDE");
    }
    expect(
      code(() =>
        appliquerPonderationsContexte(GRILLE, [
          { dimension: "couts", poids: 0 },
          { dimension: "strategie", poids: 0 },
        ]),
      ),
    ).toBe("GRILLE_INVALIDE");
  });
});
