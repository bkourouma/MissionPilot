import { describe, expect, it } from "vitest";
import {
  creerGenerateur,
  ErreurPlan,
  GRAINE_MAX,
  tirerNormale,
  tirerTriangulaire,
  tirerUniforme,
  validerGraine,
  type GenerateurAlea,
} from "./index";

function erreurDe(f: () => unknown): ErreurPlan | null {
  try {
    f();
  } catch (e) {
    return e as ErreurPlan;
  }
  return null;
}

/** Générateur scripté : rejoue des valeurs fixes en boucle. */
function scripte(valeurs: readonly number[]): GenerateurAlea {
  let i = 0;
  return { suivant: () => valeurs[i++ % valeurs.length]! };
}

function echantillon(n: number, tirage: () => number): { moyenne: number; variance: number } {
  let somme = 0;
  let carres = 0;
  for (let i = 0; i < n; i++) {
    const x = tirage();
    somme += x;
    carres += x * x;
  }
  const moyenne = somme / n;
  return { moyenne, variance: carres / n - moyenne * moyenne };
}

const N = 200_000;

describe("creerGenerateur", () => {
  it("valeurs d'or : les 5 premiers tirages des graines 0, 1 et 42 sont figés", () => {
    const attendu: Record<number, number[]> = {
      0: [
        0.932372156297788, 0.6484032042790204, 0.13589057908393443, 0.2665770510211587,
        0.8405583370476961,
      ],
      1: [
        0.06300501222722232, 0.5292907010298222, 0.4855569680221379, 0.3983332144562155,
        0.9602067982777953,
      ],
      42: [
        0.6484007823746651, 0.3632245766930282, 0.7661763997748494, 0.9465068783611059,
        0.865393620217219,
      ],
    };
    for (const graine of [0, 1, 42]) {
      const g = creerGenerateur(graine);
      expect(Array.from({ length: 5 }, () => g.suivant())).toEqual(attendu[graine]);
    }
  });

  it("est reproductible : même graine, même suite ; graines différentes, suites différentes", () => {
    const a = creerGenerateur(2026);
    const b = creerGenerateur(2026);
    const c = creerGenerateur(2027);
    const sa = Array.from({ length: 50 }, () => a.suivant());
    expect(Array.from({ length: 50 }, () => b.suivant())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.suivant())).not.toEqual(sa);
  });

  it("accepte les bornes de la graine et reste dans [0, 1)", () => {
    for (const graine of [0, GRAINE_MAX]) {
      const g = creerGenerateur(graine);
      for (let i = 0; i < 1000; i++) {
        const u = g.suivant();
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      }
    }
  });

  it("refuse une graine invalide (MONTE_CARLO_INVALIDE, chemin « graine »)", () => {
    for (const graine of [-1, GRAINE_MAX + 1, 1.5, Number.NaN, Infinity]) {
      const e = erreurDe(() => creerGenerateur(graine));
      expect(e?.code).toBe("MONTE_CARLO_INVALIDE");
      expect(e?.chemin).toBe("graine");
    }
    expect(erreurDe(() => validerGraine(42))).toBeNull();
  });

  it(`${N} tirages uniformes : moyenne 1/2 et variance 1/12`, () => {
    const g = creerGenerateur(12345);
    const { moyenne, variance } = echantillon(N, () => g.suivant());
    // Écart-type de la moyenne = √(1/12 / N) ≈ 6,5e-4 : tolérance 5 σ.
    expect(Math.abs(moyenne - 0.5)).toBeLessThan(0.0033);
    expect(Math.abs(variance / (1 / 12) - 1)).toBeLessThan(0.02);
  });
});

describe("lois", () => {
  it("uniforme(a, b) : moyenne (a+b)/2, variance (b−a)²/12", () => {
    const g = creerGenerateur(7);
    const { moyenne, variance } = echantillon(N, () => tirerUniforme(g, -4, 10));
    // σ de la moyenne = (14/√12)/√N ≈ 0,009 : tolérance 0,05.
    expect(Math.abs(moyenne - 3)).toBeLessThan(0.05);
    expect(Math.abs(variance / (14 ** 2 / 12) - 1)).toBeLessThan(0.02);
  });

  it("triangulaire(a, m, b) : moyenne (a+m+b)/3, variance (a²+m²+b²−ab−am−bm)/18", () => {
    const [a, m, b] = [-5, 0, 4];
    const g = creerGenerateur(8);
    const { moyenne, variance } = echantillon(N, () => tirerTriangulaire(g, a, m, b));
    const varianceTheorique = (a * a + m * m + b * b - a * b - a * m - m * b) / 18;
    expect(Math.abs(moyenne - (a + m + b) / 3)).toBeLessThan(0.02);
    expect(Math.abs(variance / varianceTheorique - 1)).toBeLessThan(0.02);
  });

  it("triangulaire : bornes respectées, mode aux extrémités admis", () => {
    const g = creerGenerateur(9);
    for (const [min, mode, max] of [
      [0, 0, 10],
      [0, 10, 10],
      [0, 5, 10],
    ] as const) {
      for (let i = 0; i < 2000; i++) {
        const x = tirerTriangulaire(g, min, mode, max);
        expect(x).toBeGreaterThanOrEqual(min);
        expect(x).toBeLessThanOrEqual(max);
      }
    }
  });

  it("triangulaire : inversion de la répartition aux deux branches", () => {
    // c = 0,5 ; u = 0,125 → 0 + √(0,125 × 10 × 5) = 2,5 ; u = 0,875 → 10 − √(0,125 × 10 × 5) = 7,5.
    expect(tirerTriangulaire(scripte([0.125]), 0, 5, 10)).toBeCloseTo(2.5, 12);
    expect(tirerTriangulaire(scripte([0.875]), 0, 5, 10)).toBeCloseTo(7.5, 12);
  });

  it("normale (Irwin–Hall) : moyenne, écart-type", () => {
    const g = creerGenerateur(10);
    const { moyenne, variance } = echantillon(N / 4, () => tirerNormale(g, 3, 2, -100, 100));
    expect(Math.abs(moyenne - 3)).toBeLessThan(0.03);
    expect(Math.abs(variance / 4 - 1)).toBeLessThan(0.03);
  });

  it("normale : z = somme de 12 uniformes − 6, calcul exact", () => {
    // Douze fois 0,75 : somme 9, z = 3, x = 1 + 2 × 3 = 7.
    expect(tirerNormale(scripte([0.75]), 1, 2, -100, 100)).toBe(7);
  });

  it("normale : tronquée par rejet dans [min, max]", () => {
    const g = creerGenerateur(11);
    for (let i = 0; i < 5000; i++) {
      const x = tirerNormale(g, 0, 5, -3, 3);
      expect(x).toBeGreaterThanOrEqual(-3);
      expect(x).toBeLessThanOrEqual(3);
    }
  });

  it("normale : après 50 échecs, le dernier tirage est ramené à la borne la plus proche", () => {
    // z = +3 à chaque essai : x = 6 > max (1) → ramené à max ; z = −3 : x = −6 < min → min.
    expect(tirerNormale(scripte([0.75]), 0, 2, -1, 1)).toBe(1);
    expect(tirerNormale(scripte([0.25]), 0, 2, -1, 1)).toBe(-1);
  });

  it("normale : un premier essai hors bornes est retiré (rejet) avant d'accepter", () => {
    // 12 × 0,75 → x = 6 (rejeté) ; 12 × 0,5 → x = 0 (accepté).
    const valeurs = [
      ...Array.from({ length: 12 }, () => 0.75),
      ...Array.from({ length: 12 }, () => 0.5),
    ];
    expect(tirerNormale(scripte(valeurs), 0, 2, -1, 1)).toBe(0);
  });
});
