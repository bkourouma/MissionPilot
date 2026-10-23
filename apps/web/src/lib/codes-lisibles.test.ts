import { describe, expect, it } from "vitest";
import {
  libelleCibleControle,
  libelleDeCode,
  libelleLisible,
  remplacerCodesTechniques,
} from "./codes-lisibles";

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

describe("codes de ligne d'état financier", () => {
  it("un code généré devient un libellé lisible", async () => {
    const { libellePosteEtat, estCodeLigneGenere } = await import("./codes-lisibles");
    expect(libellePosteEtat("L1_13")).toBe("Poste sans code source (page 1, ligne 13)");
    expect(libellePosteEtat("L2_5")).toBe("Poste sans code source (page 2, ligne 5)");
    expect(libellePosteEtat("TA1")).toBe("TA1");
    expect(libellePosteEtat("")).toBe("Poste sans code");
    expect(libellePosteEtat(null)).toBe("Poste sans code");
    expect(estCodeLigneGenere("L1_17")).toBe(true);
    expect(estCodeLigneGenere("TA1")).toBe(false);
  });

  it("remplace les codes générés dans un texte", async () => {
    const { remplacerCodesLignes } = await import("./codes-lisibles");
    const t = remplacerCodesLignes("Résultat du compte de résultat (L1_17) et L2_9");
    expect(t).not.toMatch(/L\d+_\d+/);
    expect(t).toContain("ligne 17");
    expect(t).toContain("page 2, ligne 9");
  });
});

describe("libelleCibleControle", () => {
  it("code de ligne généré lisible, autre code inchangé", () => {
    expect(libelleCibleControle("L1_17")).toBe("page 1, ligne 17");
    expect(libelleCibleControle("TA1")).toBe("TA1");
  });
});
