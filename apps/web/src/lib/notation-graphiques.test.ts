import { describe, expect, it } from "vitest";
import { geometrieRadar, longueurBarre, SEUILS_CLASSES } from "./notation-graphiques";

const axes = (scores: (number | null)[]) =>
  scores.map((score, i) => ({ dimension: `d${i}`, axe: `Dimension ${i}`, score }));

describe("radar de maturité : placement des scores de l'API", () => {
  it("premier axe vers le haut, score 100 au bout de l'axe, score 0 au centre", () => {
    const g = geometrieRadar(axes([100, 0, 50, 50]), 320);
    expect(g.centre).toBe(160);
    expect(g.rayon).toBe(132);
    expect(g.axes[0]).toMatchObject({ numero: 1, x: 160, y: 28, point: { x: 160, y: 28 } });
    expect(g.axes[1]!.point).toEqual({ x: 160, y: 160 });
    // Troisième axe (vers le bas), score 50 : à mi-rayon.
    expect(g.axes[2]!.point).toEqual({ x: 160, y: 226 });
    expect(g.polygone).toBe("160,28 160,160 160,226 94,160");
    expect(g.nonNotables).toBe(0);
  });

  it("anneaux aux seuils des classes et à 100", () => {
    const g = geometrieRadar(axes([10, 20, 30]));
    expect(g.anneaux.map((a) => a.valeur)).toEqual([...SEUILS_CLASSES, 100]);
    expect(g.anneaux.at(-1)!.yLibelle).toBe(28);
  });

  it("dimension non notable : pas de point ; polygone seulement avec trois points notables", () => {
    const g = geometrieRadar(axes([60, null, 70, 80]));
    expect(g.axes[1]!.point).toBeNull();
    expect(g.axes[1]!.score).toBeNull();
    expect(g.nonNotables).toBe(1);
    expect(g.polygone?.split(" ")).toHaveLength(3);
    expect(geometrieRadar(axes([60, null, null, 80])).polygone).toBeNull();
  });

  it("moins de trois axes : pas d'anneau (le tableau porte l'information)", () => {
    expect(geometrieRadar(axes([50, 60])).anneaux).toEqual([]);
  });

  it("valeurs hors échelle bornées à l'affichage", () => {
    const g = geometrieRadar(axes([120, -5, 50]));
    expect(g.axes[0]!.point).toEqual({ x: g.axes[0]!.x, y: g.axes[0]!.y });
    expect(g.axes[1]!.point).toEqual({ x: 160, y: 160 });
  });
});

describe("barres", () => {
  it("longueur = score de l'API, bornée à la piste", () => {
    expect(longueurBarre(72.4)).toBe("72.4%");
    expect(longueurBarre(0)).toBe("0%");
    expect(longueurBarre(130)).toBe("100%");
    expect(longueurBarre(null)).toBe("0%");
  });
});
