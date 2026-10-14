import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import { syntheseRisquesDd, type RisqueEntree } from "./risques";

const r = (
  id: string,
  famille: RisqueEntree["famille"],
  niveau: RisqueEntree["niveau"],
  etapeId: string | null,
  lecture: RisqueEntree["lecture"],
): RisqueEntree => ({ id, famille, niveau, etapeId, lecture });

describe("syntheseRisquesDd", () => {
  it("cas du SPEC-3b §5.4", () => {
    const s = syntheseRisquesDd([
      r("r1", "pays", "critique", "e1", "fragile"),
      r("r2", "pays", "modere", "e1", "solide"),
      r("r3", "change", "eleve", null, "etayee"),
      r("r4", "operationnel", "faible", "e2", null),
      r("r5", "operationnel", "eleve", "e2", null),
    ]);
    expect(s.total).toBe(5);
    expect(s.familles).toEqual([
      {
        famille: "pays",
        total: 2,
        parNiveau: { faible: 0, modere: 1, eleve: 0, critique: 1 },
        niveauMax: "critique",
      },
      {
        famille: "change",
        total: 1,
        parNiveau: { faible: 0, modere: 0, eleve: 1, critique: 0 },
        niveauMax: "eleve",
      },
      {
        famille: "operationnel",
        total: 2,
        parNiveau: { faible: 1, modere: 0, eleve: 1, critique: 0 },
        niveauMax: "eleve",
      },
      {
        famille: "reglementaire",
        total: 0,
        parNiveau: { faible: 0, modere: 0, eleve: 0, critique: 0 },
        niveauMax: null,
      },
    ]);
    expect(s.aDocumenter).toEqual(["r1", "r5"]);
    expect(s.parEtape).toEqual([
      { etapeId: "e1", total: 2, niveauMax: "critique" },
      { etapeId: "e2", total: 2, niveauMax: "eleve" },
    ]);
  });

  it("à documenter : niveau décroissant puis id", () => {
    const s = syntheseRisquesDd([
      r("b", "pays", "eleve", null, null),
      r("c", "pays", "critique", null, "fragile"),
      r("a", "pays", "eleve", null, "fragile"),
    ]);
    expect(s.aDocumenter).toEqual(["c", "a", "b"]);
  });

  it("liste vide", () => {
    const s = syntheseRisquesDd([]);
    expect(s.total).toBe(0);
    expect(s.familles.map((f) => f.famille)).toEqual([
      "pays",
      "change",
      "operationnel",
      "reglementaire",
    ]);
    expect(s.familles.every((f) => f.total === 0 && f.niveauMax === null)).toBe(true);
    expect(s.aDocumenter).toEqual([]);
    expect(s.parEtape).toEqual([]);
  });

  it("famille, niveau ou lecture inconnus", () => {
    const ok = r("a", "pays", "faible", null, null);
    for (const mauvais of [
      { ...ok, famille: "xyz" as never },
      { ...ok, niveau: "xyz" as never },
      { ...ok, lecture: "xyz" as never },
    ]) {
      expect(() => syntheseRisquesDd([mauvais])).toThrow(ErreurDueDiligence);
    }
  });
});
