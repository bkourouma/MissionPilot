import { describe, expect, it } from "vitest";
import {
  mesurerEfficaciteActionKpi,
  selectionnerPeriodesAvantApres,
  type PeriodeValeurKpi,
} from "./efficacite";
import { ErreurKpi } from "./erreurs";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

const p = (
  cle: string,
  debut: string,
  fin: string,
  valeur: number | null,
  close = true,
): PeriodeValeurKpi => ({ cle, debut, fin, close, valeur });

const MOIS: PeriodeValeurKpi[] = [
  p("2026-01", "2026-01-01", "2026-01-31", 10),
  p("2026-02", "2026-02-01", "2026-02-28", 12),
  p("2026-03", "2026-03-01", "2026-03-31", 11),
  p("2026-04", "2026-04-01", "2026-04-30", 14),
  p("2026-05", "2026-05-01", "2026-05-31", 16),
  p("2026-06", "2026-06-01", "2026-06-30", 18),
  p("2026-07", "2026-07-01", "2026-07-31", null),
  p("2026-08", "2026-08-01", "2026-08-31", 20, false),
];

describe("sélection des périodes avant et après l'action", () => {
  it("exclut la période de la date d'effet et prend les périodes voisines", () => {
    const s = selectionnerPeriodesAvantApres(MOIS, "2026-03-15", 2);
    expect(s.periodeEffet).toBe("2026-03");
    expect(s.avant.map((x) => x.cle)).toEqual(["2026-01", "2026-02"]);
    expect(s.apres.map((x) => x.cle)).toEqual(["2026-04", "2026-05"]);
  });

  it("une date d'effet au premier jour d'une période l'inclut après", () => {
    const s = selectionnerPeriodesAvantApres(MOIS, "2026-04-01", 2);
    expect(s.periodeEffet).toBeNull();
    expect(s.avant.map((x) => x.cle)).toEqual(["2026-02", "2026-03"]);
    expect(s.apres.map((x) => x.cle)).toEqual(["2026-04", "2026-05"]);
  });

  it("ne garde que les périodes closes et mesurées de la fenêtre", () => {
    const s = selectionnerPeriodesAvantApres(MOIS, "2026-05-31", 3);
    // Après : juin (mesuré), juillet (non mesuré), août (en cours) : seul juin reste.
    expect(s.apres.map((x) => x.cle)).toEqual(["2026-06"]);
    expect(s.avant.map((x) => x.cle)).toEqual(["2026-02", "2026-03", "2026-04"]);
  });

  it("filtre les périodes closes et mesurées AVANT de retenir la fenêtre", () => {
    // Juillet (non mesuré) ne consomme pas une place de la fenêtre « avant » de trois périodes.
    const s = selectionnerPeriodesAvantApres(MOIS, "2026-08-15", 3);
    expect(s.periodeEffet).toBe("2026-08");
    expect(s.avant.map((x) => x.cle)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(s.apres).toEqual([]);
  });

  it("trie les périodes reçues en désordre ; fenêtre par défaut de trois", () => {
    const s = selectionnerPeriodesAvantApres([...MOIS].reverse(), "2026-06-10");
    expect(s.avant.map((x) => x.cle)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(s.apres).toEqual([]);
  });

  it("refuse une fenêtre invalide", () => {
    expect(codeErreur(() => selectionnerPeriodesAvantApres(MOIS, "2026-03-15", 0))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(codeErreur(() => selectionnerPeriodesAvantApres(MOIS, "2026-03-15", 25))).toBe(
      "OPTIONS_INVALIDES",
    );
  });
});

describe("efficacité d'une action", () => {
  it("efficace : amélioration orientée au-delà de la tolérance", () => {
    const e = mesurerEfficaciteActionKpi({
      sens: "plus_haut_mieux",
      avant: [10, 12],
      apres: [14, 16],
    });
    expect(e).toMatchObject({
      verdict: "efficace",
      moyenneAvant: 11,
      moyenneApres: 15,
      variation: 4,
      variationExacte: "4",
      variationRelative: 0.3636,
      variationOrientee: 4,
      manquantAvant: 0,
      manquantApres: 0,
    });
  });

  it("le sens de lecture oriente la variation", () => {
    const e = mesurerEfficaciteActionKpi({
      sens: "plus_bas_mieux",
      avant: [10, 12],
      apres: [14, 16],
    });
    expect(e.verdict).toBe("inefficace");
    expect(e.variationOrientee).toBe(-4);
    const mieux = mesurerEfficaciteActionKpi({
      sens: "plus_bas_mieux",
      avant: [20, 22],
      apres: [10, 12],
    });
    expect(mieux.verdict).toBe("efficace");
  });

  it("neutre dans la tolérance (2 % de la moyenne avant)", () => {
    const e = mesurerEfficaciteActionKpi({
      sens: "plus_haut_mieux",
      avant: [100, 100],
      apres: [101, 101],
    });
    expect(e.verdict).toBe("neutre");
    const limite = mesurerEfficaciteActionKpi({
      sens: "plus_haut_mieux",
      avant: [100, 100],
      apres: [102, 102],
    });
    expect(limite.verdict).toBe("neutre");
    const au_dela = mesurerEfficaciteActionKpi({
      sens: "plus_haut_mieux",
      avant: [100, 100],
      apres: [103, 103],
    });
    expect(au_dela.verdict).toBe("efficace");
  });

  it("tolérances personnalisées ; absolue utile quand la moyenne avant est nulle", () => {
    const e = mesurerEfficaciteActionKpi(
      { sens: "plus_haut_mieux", avant: [0, 0], apres: [1, 1] },
      { toleranceAbsolue: 1 },
    );
    expect(e.verdict).toBe("neutre");
    expect(e.variationRelative).toBeNull();
    const large = mesurerEfficaciteActionKpi(
      { sens: "plus_haut_mieux", avant: [100], apres: [110] },
      { minimumParCote: 1, toleranceRelative: 0.2 },
    );
    expect(large.verdict).toBe("neutre");
  });

  it("indéterminée tant qu'un côté manque de périodes mesurées", () => {
    const e = mesurerEfficaciteActionKpi({
      sens: "plus_haut_mieux",
      avant: [10, 12, 11],
      apres: [14],
    });
    expect(e).toMatchObject({
      verdict: "indeterminee",
      variation: null,
      variationOrientee: null,
      manquantAvant: 0,
      manquantApres: 1,
      moyenneAvant: 11,
      moyenneApres: 14,
    });
    const vide = mesurerEfficaciteActionKpi({ sens: "plus_haut_mieux", avant: [], apres: [] });
    expect(vide).toMatchObject({ verdict: "indeterminee", moyenneAvant: null, manquantAvant: 2 });
  });

  it("refuse des options invalides", () => {
    const e = { sens: "plus_haut_mieux", avant: [1], apres: [1] } as const;
    expect(codeErreur(() => mesurerEfficaciteActionKpi({ ...e, sens: "x" as never }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(codeErreur(() => mesurerEfficaciteActionKpi(e, { minimumParCote: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(codeErreur(() => mesurerEfficaciteActionKpi(e, { toleranceRelative: -1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(
      codeErreur(() =>
        mesurerEfficaciteActionKpi({ ...e, avant: [Number.NaN] }, { minimumParCote: 1 }),
      ),
    ).toBe("NOMBRE_INVALIDE");
  });
});
