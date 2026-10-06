import { describe, expect, it } from "vitest";
import { pagesAffichees } from "./pagination";

describe("pagesAffichees", () => {
  it("affiche toutes les pages quand il y en a peu", () => {
    expect(pagesAffichees(1, 1)).toEqual([1]);
    expect(pagesAffichees(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("place des ellipses autour de la page courante", () => {
    expect(pagesAffichees(5, 10)).toEqual([1, "ellipse", 4, 5, 6, "ellipse", 10]);
    expect(pagesAffichees(1, 10)).toEqual([1, 2, "ellipse", 10]);
    expect(pagesAffichees(10, 10)).toEqual([1, "ellipse", 9, 10]);
  });

  it("remplace une ellipse d'une seule page par le numéro", () => {
    expect(pagesAffichees(3, 10)).toEqual([1, 2, 3, 4, "ellipse", 10]);
  });

  it("borne une page hors limites et gère zéro page", () => {
    expect(pagesAffichees(99, 3)).toEqual([1, 2, 3]);
    expect(pagesAffichees(0, 3)).toEqual([1, 2, 3]);
    expect(pagesAffichees(1, 0)).toEqual([]);
  });
});
