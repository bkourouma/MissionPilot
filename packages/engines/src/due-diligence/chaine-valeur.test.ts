import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import {
  syntheseChaineDeValeur,
  TOLERANCE_SOMME_PARTS_BP,
  type EtapeChaineEntree,
} from "./chaine-valeur";

function etapes(couts: (number | null)[], marges: (number | null)[]): EtapeChaineEntree[] {
  return couts.map((c, i) => ({
    id: String.fromCharCode(97 + i),
    ordre: i + 1,
    partCoutBp: c,
    partMargeBp: marges[i] ?? null,
  }));
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDueDiligence);
    return (e as ErreurDueDiligence).code;
  }
  return undefined;
}

describe("syntheseChaineDeValeur", () => {
  it("quatre étapes cohérentes : rangs de marge et étape de marge maximale", () => {
    const s = syntheseChaineDeValeur(
      etapes([3_000, 2_500, 3_000, 1_500], [500, 2_500, 5_000, 2_000]),
    );
    expect(s.totalCoutBp).toBe(10_000);
    expect(s.totalMargeBp).toBe(10_000);
    expect(s.coherenceCout).toBe("coherente");
    expect(s.coherenceMarge).toBe("coherente");
    expect(Object.fromEntries(s.etapes.map((e) => [e.id, e.rangMarge]))).toEqual({
      a: 4,
      b: 2,
      c: 1,
      d: 3,
    });
    expect(s.etapeMargeMax).toBe("c");
  });

  it("tolérance de somme : 9 950 cohérente, 9 800 incohérente", () => {
    expect(TOLERANCE_SOMME_PARTS_BP).toBe(100);
    expect(syntheseChaineDeValeur(etapes([3_000, 2_500, 3_000, 1_450], [])).coherenceCout).toBe(
      "coherente",
    );
    expect(syntheseChaineDeValeur(etapes([3_000, 2_500, 3_000, 1_300], [])).coherenceCout).toBe(
      "incoherente",
    );
    // Au-dessus de 10 000 aussi : 10 100 admis, 10 101 refusé.
    expect(syntheseChaineDeValeur(etapes([5_000, 5_100], [])).coherenceCout).toBe("coherente");
    expect(syntheseChaineDeValeur(etapes([5_000, 5_101], [])).coherenceCout).toBe("incoherente");
  });

  it("une part non renseignée : incomplète, total des seules parts renseignées", () => {
    const s = syntheseChaineDeValeur(etapes([3_000, null, 7_000], [null, null, null]));
    expect(s.coherenceCout).toBe("incomplete");
    expect(s.totalCoutBp).toBe(10_000);
    expect(s.coherenceMarge).toBe("incomplete");
    expect(s.totalMargeBp).toBe(0);
    expect(s.etapeMargeMax).toBeNull();
    expect(s.etapes.every((e) => e.rangMarge === null)).toBe(true);
  });

  it("liste vide", () => {
    expect(syntheseChaineDeValeur([])).toEqual({
      etapes: [],
      totalCoutBp: 0,
      totalMargeBp: 0,
      coherenceCout: "vide",
      coherenceMarge: "vide",
      etapeMargeMax: null,
    });
  });

  it("égalité de marges départagée par ordre puis id ; tri des étapes par ordre puis id", () => {
    const s = syntheseChaineDeValeur([
      { id: "z", ordre: 1, partCoutBp: null, partMargeBp: 1_000 },
      { id: "b", ordre: 2, partCoutBp: null, partMargeBp: 1_000 },
      { id: "a", ordre: 2, partCoutBp: null, partMargeBp: 1_000 },
    ]);
    expect(s.etapes.map((e) => [e.id, e.rangMarge])).toEqual([
      ["z", 1],
      ["a", 2],
      ["b", 3],
    ]);
    expect(s.etapeMargeMax).toBe("z");
  });

  it("entrées invalides", () => {
    const e = (liste: EtapeChaineEntree[]) => code(() => syntheseChaineDeValeur(liste));
    const ok = { id: "a", ordre: 1, partCoutBp: 0, partMargeBp: 0 };
    expect(e([ok, { ...ok }])).toBe("ENTREE_INVALIDE");
    expect(e([{ ...ok, ordre: 0 }])).toBe("ENTREE_INVALIDE");
    expect(e([{ ...ok, ordre: 1.5 }])).toBe("ENTREE_INVALIDE");
    expect(e([{ ...ok, partCoutBp: 10_001 }])).toBe("ENTREE_INVALIDE");
    expect(e([{ ...ok, partMargeBp: -1 }])).toBe("ENTREE_INVALIDE");
    expect(e([{ ...ok, partMargeBp: 0.5 }])).toBe("ENTREE_INVALIDE");
    expect(e([ok])).toBeUndefined();
  });
});
