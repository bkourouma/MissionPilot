import { describe, expect, it } from "vitest";
import { libelleDeCode, libelleLisible, remplacerCodesTechniques } from "./codes-lisibles";

describe("codes lisibles", () => {
  it("repli lisible : soulignés en espaces, jamais de plantage", () => {
    expect(libelleLisible("kpi_pertes_post_recolte")).toBe("Kpi pertes post recolte");
    expect(libelleLisible("")).toBe("");
    expect(libelleLisible(null)).toBe("");
    expect(libelleLisible(undefined)).toBe("");
    expect(libelleLisible(42)).toBe("42");
    expect(libelleLisible({})).toBe("[object Object]");
  });

  it("préfère le libellé connu, sinon le repli", () => {
    expect(libelleDeCode("a_b", { a_b: "Alpha bêta" })).toBe("Alpha bêta");
    expect(libelleDeCode("a_b", new Map([["a_b", "Alpha"]]))).toBe("Alpha");
    expect(libelleDeCode("c_d", { a_b: "x" })).toBe("C d");
  });

  it("remplace les codes d'un message, laisse le reste intact", () => {
    const table = { solidite_preuves: "Solidité des preuves" };
    expect(
      remplacerCodesTechniques(
        "2 critère(s) sans évaluation (solidite_preuves, conformite_methode).",
        table,
      ),
    ).toBe("2 critère(s) sans évaluation (Solidité des preuves, conformite methode).");
    expect(remplacerCodesTechniques("Rien à remplacer.")).toBe("Rien à remplacer.");
  });
});
