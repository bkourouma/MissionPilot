import { describe, expect, it } from "vitest";
import {
  decouperLignes,
  decouperMots,
  diffJetons,
  diffTextes,
  libelleResumeDiff,
  resumeDiff,
  type SegmentDiff,
} from "./ia-diff";

/** Recompose l'avant (égal + retrait) et l'après (égal + ajout) d'une différence. */
function recomposer(segments: readonly SegmentDiff[]) {
  return {
    avant: segments
      .filter((s) => s.nature !== "ajout")
      .map((s) => s.texte)
      .join(""),
    apres: segments
      .filter((s) => s.nature !== "retrait")
      .map((s) => s.texte)
      .join(""),
  };
}

describe("découpage", () => {
  it("garde les espaces et les sauts de ligne : la concaténation redonne le texte", () => {
    const t = "Le chiffre  progresse\nde façon nette.\n";
    expect(decouperMots(t).join("")).toBe(t);
    expect(decouperMots("a  b")).toEqual(["a", "  ", "b"]);
    expect(decouperLignes(t)).toEqual(["Le chiffre  progresse\n", "de façon nette.\n"]);
    expect(decouperMots("")).toEqual([]);
  });
});

describe("différence", () => {
  it("mot remplacé : retrait puis ajout, le reste égal", () => {
    const d = diffTextes("Le climat est bon.", "Le climat est excellent.");
    expect(d).toEqual([
      { nature: "egal", texte: "Le climat est " },
      { nature: "retrait", texte: "bon." },
      { nature: "ajout", texte: "excellent." },
    ]);
  });

  it("recompose exactement les deux versions", () => {
    const avant = "Synthèse : le chiffre d'affaires progresse de 7 %. Le climat social est bon.";
    const apres =
      "Synthèse : le chiffre d'affaires progresse. Le climat social reste bon, et stable.";
    const d = diffTextes(avant, apres);
    expect(d).not.toBeNull();
    expect(recomposer(d!)).toEqual({ avant, apres });
  });

  it("textes identiques ou vides", () => {
    expect(diffTextes("abc", "abc")).toEqual([{ nature: "egal", texte: "abc" }]);
    expect(diffTextes("", "")).toEqual([]);
    expect(diffTextes("", "Nouveau")).toEqual([{ nature: "ajout", texte: "Nouveau" }]);
    expect(diffTextes("Ancien", "")).toEqual([{ nature: "retrait", texte: "Ancien" }]);
  });

  it("au-delà de la limite : repli sur les lignes, puis null", () => {
    const a = ["x", "y", "z"];
    const b = ["p", "q", "r"];
    expect(diffJetons(a, b, 8)).toBeNull();
    expect(diffJetons(a, b, 9)).not.toBeNull();
    // Début et fin communs ne comptent pas dans la limite.
    expect(diffJetons(["a", "x", "b"], ["a", "y", "b"], 1)).toEqual([
      { nature: "egal", texte: "a" },
      { nature: "retrait", texte: "x" },
      { nature: "ajout", texte: "y" },
      { nature: "egal", texte: "b" },
    ]);
    const lignesAvant = "un deux trois\nquatre cinq six\n";
    const lignesApres = "sept huit neuf\ndix onze douze\n";
    // 11 jetons de mots de chaque côté (121 cellules) mais 2 lignes (4 cellules).
    const parLignes = diffTextes(lignesAvant, lignesApres, 10);
    expect(parLignes).toEqual([
      { nature: "retrait", texte: lignesAvant },
      { nature: "ajout", texte: lignesApres },
    ]);
    expect(diffTextes("a b c d", "e f g h", 0)).toBeNull();
  });
});

describe("résumé", () => {
  it("compte les mots ajoutés et retirés, ignore les espaces", () => {
    const d = diffTextes("Le climat est bon.", "Le climat social est très bon.")!;
    expect(resumeDiff(d)).toEqual({ ajouts: 2, retraits: 0 });
    expect(libelleResumeDiff(d)).toBe("2 mots ajoutés.");
    expect(libelleResumeDiff(diffTextes("un deux", "un")!)).toBe("1 mot retiré.");
    expect(libelleResumeDiff(diffTextes("a b", "c d e")!)).toBe("3 mots ajoutés, 2 mots retirés.");
    expect(libelleResumeDiff(diffTextes("même", "même")!)).toBe("Texte identique.");
    expect(libelleResumeDiff(diffTextes("a b", "a  b")!)).toBe(
      "Seuls des espaces ou des retours à la ligne changent.",
    );
  });
});
