import { describe, expect, it } from "vitest";
import { ErreurPlan } from "./erreurs";
import { echeancierEmprunt, type EmpruntPlan } from "./index";

const base: EmpruntPlan = {
  libelle: "Prêt",
  anneeDeblocage: 1,
  montant: 1_000_000,
  tauxAnnuel: 10,
  duree: 2,
};

describe("echeancierEmprunt", () => {
  it("annuités constantes : 1 000 000 à 10 % sur 2 ans", () => {
    const e = echeancierEmprunt(base);
    expect(e.echeances).toEqual([
      {
        rang: 1,
        annee: 1,
        capitalDebut: 1_000_000,
        interets: 100_000,
        amortissement: 476_190,
        annuite: 576_190,
        capitalFin: 523_810,
      },
      {
        rang: 2,
        annee: 2,
        capitalDebut: 523_810,
        interets: 52_381,
        amortissement: 523_810,
        annuite: 576_191,
        capitalFin: 0,
      },
    ]);
    expect(e.totalInterets).toBe(152_381);
  });

  it("amortissement constant : reste d'arrondi sur la dernière échéance", () => {
    const e = echeancierEmprunt({
      ...base,
      montant: 100,
      duree: 3,
      mode: "amortissement_constant",
    });
    expect(e.echeances.map((x) => x.amortissement)).toEqual([33, 33, 34]);
    expect(e.echeances.map((x) => x.interets)).toEqual([10, 7, 3]);
  });

  it("taux nul en annuités constantes : amortissement constant", () => {
    const e = echeancierEmprunt({ ...base, tauxAnnuel: 0, montant: 900, duree: 3 });
    expect(e.echeances.map((x) => x.annuite)).toEqual([300, 300, 300]);
    expect(e.totalInterets).toBe(0);
  });

  it("différé : intérêts seuls, puis annuités sur la durée restante", () => {
    const e = echeancierEmprunt({ ...base, anneeDeblocage: 2, duree: 3, differe: 1 });
    expect(e.echeances.map((x) => [x.annee, x.interets, x.amortissement])).toEqual([
      [2, 100_000, 0],
      [3, 100_000, 476_190],
      [4, 52_381, 523_810],
    ]);
  });

  it("emprunt en cours à l'ouverture : première échéance en année 1", () => {
    const e = echeancierEmprunt({ ...base, anneeDeblocage: 0 });
    expect(e.echeances.map((x) => x.annee)).toEqual([1, 2]);
  });

  it("solde toujours le capital, quelle que soit la combinaison", () => {
    for (const taux of [0, 3.5, 7.25, 12, 18]) {
      for (const duree of [1, 2, 5, 7, 15]) {
        for (const mode of ["annuites_constantes", "amortissement_constant"] as const) {
          const e = echeancierEmprunt({
            ...base,
            montant: 12_345_679,
            tauxAnnuel: taux,
            duree,
            mode,
            differe: duree > 2 ? 1 : 0,
          });
          const rembourse = e.echeances.reduce((s, x) => s + x.amortissement, 0);
          expect(rembourse).toBe(12_345_679);
          expect(e.echeances.at(-1)?.capitalFin).toBe(0);
          expect(e.echeances.every((x) => x.amortissement >= 0 && x.interets >= 0)).toBe(true);
        }
      }
    }
  });

  it("refuse un emprunt invalide", () => {
    const refus = (e: EmpruntPlan) => {
      try {
        echeancierEmprunt(e);
      } catch (err) {
        return [(err as ErreurPlan).code, (err as ErreurPlan).chemin];
      }
      return null;
    };
    expect(refus({ ...base, montant: 0 })).toEqual(["MONTANT_INVALIDE", "emprunt.montant"]);
    expect(refus({ ...base, duree: 0 })).toEqual(["EMPRUNT_INVALIDE", "emprunt.duree"]);
    expect(refus({ ...base, differe: 2 })).toEqual(["EMPRUNT_INVALIDE", "emprunt.differe"]);
    expect(refus({ ...base, anneeDeblocage: -1 })).toEqual([
      "EMPRUNT_INVALIDE",
      "emprunt.anneeDeblocage",
    ]);
    expect(refus({ ...base, tauxAnnuel: 101 })).toEqual([
      "HYPOTHESE_INVALIDE",
      "emprunt.tauxAnnuel",
    ]);
    expect(refus({ ...base, libelle: " " })).toEqual(["HYPOTHESE_INVALIDE", "emprunt.libelle"]);
    expect(refus({ ...base, mode: "in_fine" as never })).toEqual([
      "EMPRUNT_INVALIDE",
      "emprunt.mode",
    ]);
  });
});
