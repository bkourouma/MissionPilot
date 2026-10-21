import { describe, expect, it } from "vitest";
import { analyserHeritage, type NoeudMethode, type NoeudVersion } from "./heritage";

const m = (id: string, parent_id: string | null = null): NoeudMethode => ({ id, parent_id });
const v = (
  id: string,
  methode_id: string,
  base_standard_id: string | null = null,
  statut: NoeudVersion["statut"] = "publiee",
): NoeudVersion => ({ id, methode_id, base_standard_id, statut });

describe("analyserHeritage", () => {
  it("accepte des listes vides et une chaîne saine", () => {
    expect(analyserHeritage([], [])).toEqual([]);
    expect(
      analyserHeritage(
        [m("std"), m("cab", "std")],
        [v("v1", "std"), v("v2", "cab", "v1", "brouillon")],
      ),
    ).toEqual([]);
  });

  it("CYCLE_HERITAGE sur les méthodes : cycle listé une seule fois, partant du plus petit", () => {
    const r = analyserHeritage([m("c", "a"), m("a", "b"), m("b", "c"), m("d", "a")], []);
    expect(r).toEqual([
      expect.objectContaining({
        code: "CYCLE_HERITAGE",
        gravite: "erreur",
        regle: null,
        chemin: "methodes.a",
        message: "Cycle d'héritage (parent_id) : a → b → c → a.",
      }),
    ]);
  });

  it("CYCLE_HERITAGE : auto-référence, et cycle sur les versions", () => {
    const r = analyserHeritage(
      [m("a", "a")],
      [v("x", "a", "y"), v("y", "a", "x"), v("z", "a", "z")],
    );
    expect(r.map((x) => x.message)).toEqual([
      "Cycle d'héritage (parent_id) : a → a.",
      "Cycle d'héritage (base_standard_id) : x → y → x.",
      "Cycle d'héritage (base_standard_id) : z → z.",
    ]);
  });

  it("REFERENCE_CASSEE : parent, méthode de version et base absents", () => {
    const r = analyserHeritage([m("a", "fantome")], [v("v1", "absente", "inconnue")]);
    expect(r.map((x) => x.chemin)).toEqual([
      "methodes.a.parent",
      "versions.v1.base",
      "versions.v1.methode",
    ]);
    expect(r.every((x) => x.code === "REFERENCE_CASSEE" && x.gravite === "erreur")).toBe(true);
  });

  it("HERITAGE_INCOHERENT : méthode de la base différente du parent", () => {
    const r = analyserHeritage(
      [m("std"), m("autre"), m("cab", "std")],
      [v("v1", "autre"), v("v2", "cab", "v1")],
    );
    expect(r).toEqual([
      expect.objectContaining({
        code: "HERITAGE_INCOHERENT",
        chemin: "versions.v2.base",
        gravite: "erreur",
      }),
    ]);
    expect(r[0]!.message).toContain("n'est pas la méthode parente");
  });

  it("HERITAGE_INCOHERENT : base non publiée (cumulable avec l'incohérence de méthode)", () => {
    const seul = analyserHeritage(
      [m("std"), m("cab", "std")],
      [v("v1", "std", null, "brouillon"), v("v2", "cab", "v1")],
    );
    expect(seul).toHaveLength(1);
    expect(seul[0]!.message).toContain("n'est pas publiée");
    const double = analyserHeritage(
      [m("std"), m("cab")],
      [v("v1", "std", null, "brouillon"), v("v2", "cab", "v1")],
    );
    expect(double).toHaveLength(2);
  });

  it("une version sans méthode ne déclenche pas d'incohérence en plus de la référence cassée", () => {
    const r = analyserHeritage([m("std")], [v("v1", "std"), v("v2", "absente", "v1")]);
    expect(r.map((x) => x.code)).toEqual(["REFERENCE_CASSEE"]);
  });

  it("ignore les doublons d'identifiant et reste déterministe quel que soit l'ordre", () => {
    const methodes = [m("a", "b"), m("b", "a"), m("a", "b")];
    const versions = [v("x", "a", "y"), v("y", "b", "x")];
    const r1 = analyserHeritage(methodes, versions);
    const r2 = analyserHeritage([...methodes].reverse(), [...versions].reverse());
    expect(r2.map((x) => x.message).sort()).toEqual(r1.map((x) => x.message).sort());
    expect(analyserHeritage(methodes, versions)).toEqual(r1);
  });

  it("termine sur un grand cycle", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `n${String(i).padStart(3, "0")}`);
    const methodes = ids.map((id, i) => m(id, ids[(i + 1) % ids.length]));
    expect(analyserHeritage(methodes, [])).toHaveLength(1);
  });
});
