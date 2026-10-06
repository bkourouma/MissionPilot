/**
 * Propriétés de la notation, vérifiées sur des jeux pseudo-aléatoires
 * reproductibles (graine fixe) : bornes, monotonie, déterminisme et
 * invariance à l'ordre des répondants.
 */
import { describe, expect, it } from "vitest";
import { GRILLE, generateur, reponsesAleatoires } from "./fixtures.test-utils";
import { noterRepondants } from "./repondants";
import { scoreGlobal, type OptionsNotation } from "./score";

const STRATEGIES: OptionsNotation[] = [
  {},
  { strategie: "penaliser" },
  { secteur: "numerique", couvertureMinimale: 0, couvertureGlobaleMinimale: 0 },
];

describe("propriétés du score", () => {
  it("le score global et les scores de dimension restent dans [0, 100]", () => {
    const alea = generateur(42);
    for (let i = 0; i < 300; i += 1) {
      const options = STRATEGIES[i % STRATEGIES.length];
      const r = scoreGlobal(GRILLE, reponsesAleatoires(alea), options);
      for (const s of [r.score, ...r.dimensions.map((d) => d.score)]) {
        if (s !== null) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(100);
        }
      }
      expect(r.couverture).toBeGreaterThanOrEqual(0);
      expect(r.couverture).toBeLessThanOrEqual(1);
    }
  });

  it("est monotone : améliorer une réponse ne fait jamais baisser le score", () => {
    const alea = generateur(7);
    for (let i = 0; i < 300; i += 1) {
      const options = STRATEGIES[i % STRATEGIES.length];
      const base = reponsesAleatoires(alea);
      const avant = scoreGlobal(GRILLE, base, options);
      // q1 : Likert direct (plus haut = mieux) ; q6 : Likert inversé (plus bas = mieux) ;
      // q4 : seuils croissants ; q5 : interpolation décroissante.
      const mieux = {
        ...base,
        q1: base.q1 === null ? null : Math.min(5, (base.q1 as number) + 1),
        q6: base.q6 === null ? null : Math.max(1, (base.q6 as number) - 1),
        q4: base.q4 === null ? null : (base.q4 as number) + 3,
        q5: base.q5 === null ? null : Math.max(0, (base.q5 as number) - 3),
        q3: base.q3 === null ? null : true,
      };
      const apres = scoreGlobal(GRILLE, mieux, options);
      expect(apres.notable).toBe(avant.notable);
      if (avant.scoreExact !== null) {
        expect(apres.score as number).toBeGreaterThanOrEqual(avant.score as number);
      }
      apres.dimensions.forEach((d, j) => {
        const a = avant.dimensions[j]?.score;
        if (a !== null && a !== undefined) expect(d.score as number).toBeGreaterThanOrEqual(a);
      });
    }
  });

  it("est déterministe : même entrée, même sortie", () => {
    const alea = generateur(2026);
    for (let i = 0; i < 50; i += 1) {
      const reponses = reponsesAleatoires(alea);
      expect(scoreGlobal(GRILLE, reponses, { secteur: "industrie" })).toEqual(
        scoreGlobal(GRILLE, { ...reponses }, { secteur: "industrie" }),
      );
    }
  });

  it("est invariant à l'ordre des répondants", () => {
    const alea = generateur(99);
    for (let i = 0; i < 50; i += 1) {
      const jeux = ["a", "b", "c", "d"].map((repondant, k) => ({
        repondant,
        role: k % 2 === 0 ? "dirigeant" : "contributeur",
        reponses: reponsesAleatoires(alea),
      }));
      const options = {
        poidsRoles: [{ role: "dirigeant", poids: 2.5 }],
        couvertureGlobaleMinimale: 0,
      };
      const reference = noterRepondants(GRILLE, jeux, options);
      expect(noterRepondants(GRILLE, [...jeux].reverse(), options)).toEqual(reference);
      expect(noterRepondants(GRILLE, [jeux[2]!, jeux[0]!, jeux[3]!, jeux[1]!], options)).toEqual(
        reference,
      );
    }
  });
});
