import { describe, expect, it } from "vitest";
import { libellePlage, plageAffichee } from "./Pagination.plage";

describe("plageAffichee", () => {
  it("calcule la deuxième page de 20 sur 134", () => {
    expect(plageAffichee(2, 20, 134)).toEqual({ debut: 21, fin: 40, total: 134 });
  });
  it("tronque la dernière page au total", () => {
    expect(plageAffichee(7, 20, 134)).toEqual({ debut: 121, fin: 134, total: 134 });
  });
  it("ramène la page dans les bornes", () => {
    expect(plageAffichee(99, 20, 134)?.debut).toBe(121);
    expect(plageAffichee(0, 20, 134)?.debut).toBe(1);
  });
  it("renvoie null sans total, taille ou éléments", () => {
    expect(plageAffichee(1, undefined, 10)).toBeNull();
    expect(plageAffichee(1, 20, undefined)).toBeNull();
    expect(plageAffichee(1, 20, 0)).toBeNull();
    expect(plageAffichee(1, 0, 10)).toBeNull();
    expect(plageAffichee(1, 20, Number.NaN)).toBeNull();
  });
});

describe("libellePlage", () => {
  it("formate en français", () => {
    expect(libellePlage({ debut: 21, fin: 40, total: 134 }, "fr")).toBe("21–40 sur 134");
  });
  it("formate en anglais", () => {
    expect(libellePlage({ debut: 21, fin: 40, total: 134 }, "en")).toBe("21–40 of 134");
  });
  it("groupe les milliers selon la langue", () => {
    expect(libellePlage({ debut: 1, fin: 20, total: 1234 }, "en")).toBe("1–20 of 1,234");
    expect(libellePlage({ debut: 1, fin: 20, total: 1234 }, "fr")).toMatch(/^1–20 sur 1\s234$/u);
  });
  it("n'affiche pas d'intervalle pour un seul élément", () => {
    expect(libellePlage({ debut: 5, fin: 5, total: 5 }, "fr")).toBe("5 sur 5");
  });
});
