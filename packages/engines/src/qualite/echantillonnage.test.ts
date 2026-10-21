import { describe, expect, it } from "vitest";
import {
  empreinteTexte,
  tirerEchantillon,
  type CandidatEchantillon,
  type CriteresTirage,
} from "./index";
import { ErreurQualite } from "./erreurs";

const criteres = (p: Partial<CriteresTirage> = {}): CriteresTirage => ({
  periode_debut: "2026-01-01",
  periode_fin: "2026-12-31",
  types_mission_ids: [],
  directeur_ids: [],
  stratifier_par: null,
  exclus: [],
  ...p,
});

const candidats: CandidatEchantillon[] = Array.from({ length: 40 }, (_, i) => ({
  id: `m${String(i).padStart(3, "0")}`,
  type_mission_id: i % 4 === 0 ? null : `t${i % 3}`,
  directeur_id: i % 5 === 0 ? null : `d${i % 2}`,
  cloturee_le: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
}));

const ids = (r: { selection: { id: string }[] }) => r.selection.map((s) => s.id);

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof ErreurQualite ? e.code : "autre";
  }
  return "aucune";
};

describe("empreinteTexte", () => {
  it("est déterministe, sur 14 caractères hexadécimaux", () => {
    expect(empreinteTexte("abc")).toBe(empreinteTexte("abc"));
    expect(empreinteTexte("abc")).toMatch(/^[0-9a-f]{14}$/);
    expect(empreinteTexte("")).toMatch(/^[0-9a-f]{14}$/);
    expect(empreinteTexte("abc")).not.toBe(empreinteTexte("abd"));
  });
});

describe("tirerEchantillon", () => {
  it("est reproductible, quel que soit l'ordre des candidats", () => {
    const a = tirerEchantillon(candidats, criteres(), 10, "graine-1");
    const b = tirerEchantillon([...candidats].reverse(), criteres(), 10, "graine-1");
    expect(b).toEqual(a);
    expect(a.selection.map((s) => s.rang)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a.taille_obtenue).toBe(10);
    expect(a.taille_demandee).toBe(10);
    expect(a.graine).toBe("graine-1");
  });

  it("change de tirage avec une autre graine", () => {
    const a = tirerEchantillon(candidats, criteres(), 10, "graine-1");
    const b = tirerEchantillon(candidats, criteres(), 10, "graine-2");
    expect(ids(a)).not.toEqual(ids(b));
    expect(b.empreinte_population).toBe(a.empreinte_population);
  });

  it("trie la population par id et dédoublonne", () => {
    const r = tirerEchantillon([...candidats, candidats[3]!], criteres(), 5, "g");
    expect(r.population).toEqual([...r.population].sort());
    expect(r.population).toHaveLength(40);
  });

  it("filtre période (bornes incluses), types, directeurs et exclus", () => {
    const c: CandidatEchantillon[] = [
      { id: "a", type_mission_id: "t1", directeur_id: "d1", cloturee_le: "2026-03-01" },
      { id: "b", type_mission_id: "t1", directeur_id: "d1", cloturee_le: "2026-03-31" },
      { id: "c", type_mission_id: "t2", directeur_id: "d1", cloturee_le: "2026-03-15" },
      { id: "d", type_mission_id: "t1", directeur_id: "d2", cloturee_le: "2026-03-15" },
      { id: "e", type_mission_id: null, directeur_id: null, cloturee_le: "2026-03-15" },
      { id: "f", type_mission_id: "t1", directeur_id: "d1", cloturee_le: "2026-04-01" },
      { id: "g", type_mission_id: "t1", directeur_id: "d1", cloturee_le: "2026-02-28" },
      { id: "h", type_mission_id: "t1", directeur_id: "d1", cloturee_le: "2026-03-10" },
    ];
    const periode = { periode_debut: "2026-03-01", periode_fin: "2026-03-31" };
    const r = tirerEchantillon(
      c,
      criteres({
        ...periode,
        types_mission_ids: ["t1"],
        directeur_ids: ["d1"],
        exclus: ["h"],
      }),
      10,
      "g",
    );
    expect(r.population).toEqual(["a", "b"]);
    const tous = tirerEchantillon(c, criteres(periode), 10, "g");
    expect(tous.population).toEqual(["a", "b", "c", "d", "e", "h"]);
  });

  it("limite la taille à la population", () => {
    const r = tirerEchantillon(candidats.slice(0, 3), criteres(), 10, "g");
    expect(r.taille_demandee).toBe(10);
    expect(r.taille_obtenue).toBe(3);
    expect(r.selection).toHaveLength(3);
  });

  it("renvoie un tirage vide sans éligible", () => {
    const r = tirerEchantillon([], criteres(), 5, "g");
    expect(r.taille_obtenue).toBe(0);
    expect(r.selection).toEqual([]);
    expect(r.population).toEqual([]);
  });

  it("stratifie en tourniquet, null en dernier", () => {
    const c: CandidatEchantillon[] = [];
    for (const t of ["tB", "tA", null]) {
      for (let i = 0; i < 5; i++) {
        c.push({
          id: `${t ?? "z"}${i}`,
          type_mission_id: t,
          directeur_id: null,
          cloturee_le: "2026-05-05",
        });
      }
    }
    const r = tirerEchantillon(c, criteres({ stratifier_par: "type_mission" }), 6, "g");
    const types = r.selection.map((s) => c.find((x) => x.id === s.id)!.type_mission_id);
    expect(types).toEqual(["tA", "tB", null, "tA", "tB", null]);
    const simple = tirerEchantillon(c, criteres(), 15, "g");
    const premiersA = simple.selection.filter((s) => s.id.startsWith("tA")).map((s) => s.id);
    expect(r.selection.filter((s) => s.id.startsWith("tA")).map((s) => s.id)).toEqual(
      premiersA.slice(0, 2),
    );
  });

  it("épuise les petites strates puis continue", () => {
    const c: CandidatEchantillon[] = [
      { id: "1", type_mission_id: null, directeur_id: "d1", cloturee_le: "2026-05-05" },
      { id: "2", type_mission_id: null, directeur_id: "d2", cloturee_le: "2026-05-05" },
      { id: "3", type_mission_id: null, directeur_id: "d2", cloturee_le: "2026-05-05" },
      { id: "4", type_mission_id: null, directeur_id: "d2", cloturee_le: "2026-05-05" },
    ];
    const r = tirerEchantillon(c, criteres({ stratifier_par: "directeur" }), 4, "g");
    expect(r.taille_obtenue).toBe(4);
    expect(ids(r)[0]).toBe("1");
    expect(new Set(ids(r)).size).toBe(4);
  });

  it("refuse les entrées invalides", () => {
    const E = "ECHANTILLON_INVALIDE";
    expect(code(() => tirerEchantillon(candidats, criteres(), 0, "g"))).toBe(E);
    expect(code(() => tirerEchantillon(candidats, criteres(), 1.5, "g"))).toBe(E);
    expect(code(() => tirerEchantillon(candidats, criteres(), 3, ""))).toBe(E);
    expect(code(() => tirerEchantillon(candidats, criteres(), 3, "x".repeat(65)))).toBe(E);
    for (const p of [
      { periode_debut: "2026-02-30" },
      { periode_fin: "2026-13-01" },
      { periode_fin: "demain" },
      { periode_debut: "2026-00-10" },
      { periode_debut: "2026-05-00" },
    ]) {
      expect(code(() => tirerEchantillon(candidats, criteres(p), 3, "g"))).toBe(E);
    }
    expect(
      code(() =>
        tirerEchantillon(
          candidats,
          criteres({ periode_debut: "2026-06-01", periode_fin: "2026-05-01" }),
          3,
          "g",
        ),
      ),
    ).toBe(E);
  });

  it("gère les années bissextiles", () => {
    const essai = (d: string) =>
      code(() =>
        tirerEchantillon([], criteres({ periode_debut: d, periode_fin: "2101-01-01" }), 1, "g"),
      );
    expect(essai("2028-02-29")).toBe("aucune");
    expect(essai("2000-02-29")).toBe("aucune");
    expect(essai("2026-02-29")).toBe("ECHANTILLON_INVALIDE");
    expect(essai("2100-02-29")).toBe("ECHANTILLON_INVALIDE");
  });
});
