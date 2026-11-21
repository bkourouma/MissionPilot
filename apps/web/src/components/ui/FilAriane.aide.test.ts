import { describe, expect, it } from "vitest";
import { elementsFil } from "./FilAriane.aide";

describe("elementsFil", () => {
  it("marque le dernier maillon comme page courante, sans lien", () => {
    expect(
      elementsFil([
        { href: "/missions", libelle: "Missions" },
        { href: "/missions/1", libelle: "Audit 2026" },
      ]),
    ).toEqual([
      { libelle: "Missions", href: "/missions", courant: false },
      { libelle: "Audit 2026", href: null, courant: true },
    ]);
  });
  it("garde sans lien un maillon intermédiaire sans href", () => {
    const r = elementsFil([{ libelle: "Cabinet" }, { href: "/a", libelle: "A" }, { libelle: "B" }]);
    expect(r.map((e) => e.href)).toEqual([null, "/a", null]);
    expect(r.map((e) => e.courant)).toEqual([false, false, true]);
  });
  it("ignore les libellés vides", () => {
    const r = elementsFil([{ href: "/x", libelle: "  " }, { libelle: "Seul" }]);
    expect(r).toEqual([{ libelle: "Seul", href: null, courant: true }]);
  });
  it("renvoie une liste vide sans maillon", () => {
    expect(elementsFil([])).toEqual([]);
  });
});
