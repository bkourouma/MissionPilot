import { describe, expect, it } from "vitest";
import {
  echelle,
  estLibellee,
  formeRepere,
  geometrieSerie,
  pasArrondi,
  pointsTriangle,
  type PointSerieEntree,
} from "./kpi-graphiques";

const point = (
  periode: string,
  valeur: number | null,
  cible: number | null = null,
  close = true,
): PointSerieEntree => ({ periode, valeur, cible, statut: "vert", close });

describe("échelle de l'axe des valeurs", () => {
  it("pas ronds (1, 2, 2,5, 5 × 10^n)", () => {
    expect(pasArrondi(125)).toBe(200);
    expect(pasArrondi(0.3)).toBe(0.5);
    expect(pasArrondi(2.2)).toBe(2.5);
    expect(pasArrondi(10)).toBe(10);
    expect(pasArrondi(0)).toBe(1);
  });

  it("graduations qui encadrent toutes les valeurs", () => {
    expect(echelle([700, 1200, 1000])).toEqual([600, 800, 1000, 1200]);
    expect(echelle([-5, 5])).toEqual([-5, -2.5, 0, 2.5, 5]);
    expect(echelle([0.1, 0.3])).toEqual([0.1, 0.15, 0.2, 0.25, 0.3]);
  });

  it("série plate : marge de 10 % (ou 1 autour de zéro)", () => {
    expect(echelle([50])).toEqual([45, 47.5, 50, 52.5, 55]);
    expect(echelle([0, 0])).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});

describe("abscisses libellées sans chevauchement", () => {
  it("première et dernière toujours, au plus `max` libellés", () => {
    const libellees = (n: number, max: number) =>
      Array.from({ length: n }, (_, i) => i).filter((i) => estLibellee(i, n, max));
    expect(libellees(1, 5)).toEqual([0]);
    expect(libellees(4, 5)).toEqual([0, 1, 2, 3]);
    expect(libellees(12, 5)).toEqual([0, 3, 6, 11]);
    expect(libellees(13, 5)).toEqual([0, 3, 6, 9, 12]);
    expect(libellees(36, 5)).toEqual([0, 9, 18, 35]);
  });
});

describe("géométrie de la série (placement des valeurs de l'API)", () => {
  it("valeurs et cibles placées sur la même échelle, haut = grande valeur", () => {
    const g = geometrieSerie(
      [point("2026-01", 1000, 1000), point("2026-02", 900, 1000), point("2026-03", 800, 1200)],
      { largeur: 400, hauteur: 220 },
    );
    expect(g.vide).toBe(false);
    expect(g.zone).toEqual({ gauche: 52, droite: 388, haut: 12, bas: 188 });
    expect(g.graduations.map((x) => x.valeur)).toEqual([800, 900, 1000, 1100, 1200]);
    expect(g.graduations[0]?.y).toBe(188);
    expect(g.graduations.at(-1)?.y).toBe(12);
    expect(g.abscisses.map((a) => a.x)).toEqual([52, 220, 388]);
    expect(g.points.map((p) => [p.x, p.y])).toEqual([
      [52, 100],
      [220, 144],
      [388, 188],
    ]);
    expect(g.traitsValeur).toEqual(["52,100 220,144 388,188"]);
    expect(g.traitsCible).toEqual(["52,100 220,100 388,12"]);
  });

  it("période non mesurée : le tracé est coupé, aucun point inventé", () => {
    const g = geometrieSerie([
      point("a", 1),
      point("b", 2),
      point("c", null),
      point("d", 3),
      point("e", 4),
      point("f", null),
      point("g", 5),
    ]);
    expect(g.traitsValeur).toHaveLength(2);
    expect(g.points.map((p) => p.periode)).toEqual(["a", "b", "d", "e", "g"]);
  });

  it("une seule période : centrée ; aucune valeur : graphique vide", () => {
    const seule = geometrieSerie([point("2026", 5, 6)]);
    expect(seule.abscisses[0]?.x).toBe(220);
    expect(seule.traitsValeur).toEqual([]);
    expect(seule.points).toHaveLength(1);
    const vide = geometrieSerie([point("2026-01", null), point("2026-02", null)]);
    expect(vide.vide).toBe(true);
    expect(vide.graduations).toEqual([]);
    expect(vide.abscisses).toHaveLength(2);
  });

  it("libellés fournis par l'appelant (périodes et valeurs)", () => {
    const g = geometrieSerie([point("2026-01", 1), point("2026-02", 2)], {
      libellePeriode: (c) => `P${c.slice(5)}`,
      libelleValeur: (v) => `${v} u`,
    });
    expect(g.abscisses.map((a) => a.libelle)).toEqual(["P01", "P02"]);
    expect(g.graduations[0]?.libelle).toMatch(/ u$/);
  });
});

describe("repères des points : la forme double la couleur", () => {
  it("vert rond, orange carré, rouge triangle, autres anneau", () => {
    expect(formeRepere("vert")).toBe("rond");
    expect(formeRepere("orange")).toBe("carre");
    expect(formeRepere("rouge")).toBe("triangle");
    expect(formeRepere("sans_cible")).toBe("anneau");
    expect(formeRepere("non_mesure")).toBe("anneau");
    expect(pointsTriangle(10, 10, 6)).toBe("10,3.1 16,14.14 4,14.14");
  });
});
