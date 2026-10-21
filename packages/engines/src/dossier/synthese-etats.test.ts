import { describe, expect, it } from "vitest";
import { ErreurDossier } from "./erreurs";
import { CODES_ALERTE_SYNTHESE, syntheseEtatsFinanciers } from "./synthese-etats";
import type { EtatPourSynthese } from "./synthese-etats";

function etat(exercice: number, o: Partial<EtatPourSynthese> = {}): EtatPourSynthese {
  return {
    exercice,
    dateCloture: `${exercice}-12-31`,
    devise: "XOF",
    totaux: { actif: 1000, passif: 1000, charges: 800, produits: 1000, resultat: 200 },
    conforme: true,
    complet: true,
    acceptation: "automatique",
    ...o,
  };
}

const codes = (s: ReturnType<typeof syntheseEtatsFinanciers>) => s.alertes.map((a) => a.code);

describe("syntheseEtatsFinanciers", () => {
  it("liste vide : aucun exercice", () => {
    expect(syntheseEtatsFinanciers([])).toEqual({ devise: null, exercices: [], alertes: [] });
  });

  it("un seul exercice : marge, pas de variation, aucune alerte", () => {
    const s = syntheseEtatsFinanciers([etat(2024)]);
    expect(s.devise).toBe("XOF");
    expect(s.exercices).toHaveLength(1);
    const l = s.exercices[0]!;
    expect(l.ecartBilan).toBe(0);
    expect(l.margeNetteBps).toBe(2000);
    expect(l.variationProduitsBps).toBeNull();
    expect(l.variationResultatBps).toBeNull();
    expect(l.variationActifBps).toBeNull();
    expect(l.variationExerciceConsecutif).toBe(false);
    expect(s.alertes).toEqual([]);
  });

  it("deux exercices consécutifs : variations exactes et arrondies", () => {
    const s = syntheseEtatsFinanciers([
      etat(2023, {
        totaux: { actif: 3000, passif: 3000, charges: 700, produits: 900, resultat: 200 },
      }),
      etat(2024, {
        totaux: { actif: 4000, passif: 4000, charges: 800, produits: 1000, resultat: 200 },
      }),
    ]);
    const l = s.exercices[1]!;
    expect(l.variationExerciceConsecutif).toBe(true);
    // 100 / 900 = 0,1111 -> 1111
    expect(l.variationProduitsBps).toBe(1111);
    expect(l.variationResultatBps).toBe(0);
    // 1000 / 3000 = 0,3333 -> 3333
    expect(l.variationActifBps).toBe(3333);
    expect(s.alertes).toEqual([]);
  });

  it("arrondi demi s'éloignant de zéro, y compris négatif", () => {
    const s = syntheseEtatsFinanciers([
      etat(2023, {
        totaux: { actif: 20000, passif: 20000, charges: 0, produits: 20000, resultat: 1 },
      }),
      etat(2024, {
        totaux: { actif: 20001, passif: 20001, charges: 0, produits: 19999, resultat: 1 },
      }),
    ]);
    // +1/20000 = 0,00005 -> 0,0001 -> 1 ; -1/20000 = -0,00005 -> -0,0001 -> -1
    expect(s.exercices[1]!.variationActifBps).toBe(1);
    expect(s.exercices[1]!.variationProduitsBps).toBe(-1);
  });

  it("précédent nul : variation nulle (null)", () => {
    const s = syntheseEtatsFinanciers([
      etat(2023, { totaux: { actif: 0, passif: 0, charges: 0, produits: 0, resultat: 0 } }),
      etat(2024),
    ]);
    const l = s.exercices[1]!;
    expect(l.variationProduitsBps).toBeNull();
    expect(l.variationResultatBps).toBeNull();
    expect(l.variationActifBps).toBeNull();
    expect(s.exercices[0]!.margeNetteBps).toBeNull();
  });

  it("précédent négatif : divise par la valeur absolue", () => {
    const s = syntheseEtatsFinanciers([
      etat(2023, {
        totaux: { actif: 1000, passif: 1000, charges: 1100, produits: 1000, resultat: -100 },
      }),
      etat(2024, {
        totaux: { actif: 1000, passif: 1000, charges: 900, produits: 1000, resultat: 100 },
      }),
    ]);
    // (100 - -100) / 100 = +2 -> 20000
    expect(s.exercices[1]!.variationResultatBps).toBe(20000);
    expect(s.exercices[0]!.margeNetteBps).toBe(-1000);
  });

  it("exercices non consécutifs : variations nulles et alerte", () => {
    const s = syntheseEtatsFinanciers([etat(2021), etat(2024)]);
    const l = s.exercices[1]!;
    expect(l.variationExerciceConsecutif).toBe(false);
    expect(l.variationProduitsBps).toBeNull();
    expect(codes(s)).toEqual(["EXERCICES_NON_CONSECUTIFS"]);
    expect(s.alertes[0]!.exercice).toBe(2024);
  });

  it("ordre d'entrée mélangé : même sortie", () => {
    const a = etat(2022);
    const b = etat(2023, {
      totaux: { actif: 1500, passif: 1500, charges: 900, produits: 1200, resultat: 300 },
    });
    const c = etat(2024);
    const ordonne = syntheseEtatsFinanciers([a, b, c]);
    expect(syntheseEtatsFinanciers([c, a, b])).toEqual(ordonne);
    expect(ordonne.exercices.map((l) => l.exercice)).toEqual([2022, 2023, 2024]);
  });

  it("devises mélangées : DEVISES_MIXTES", () => {
    try {
      syntheseEtatsFinanciers([etat(2023), etat(2024, { devise: "EUR" })]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurDossier);
      expect((e as ErreurDossier).code).toBe("DEVISES_MIXTES");
    }
  });

  it("doublon d'exercice : EXERCICE_EN_DOUBLE", () => {
    try {
      syntheseEtatsFinanciers([etat(2024), etat(2024)]);
      expect.unreachable();
    } catch (e) {
      expect((e as ErreurDossier).code).toBe("EXERCICE_EN_DOUBLE");
    }
  });

  it("totaux null : écart et variations nuls, alertes DONNEE_MANQUANTE", () => {
    const vide = { actif: null, passif: null, charges: null, produits: null, resultat: null };
    const s = syntheseEtatsFinanciers([etat(2023), etat(2024, { totaux: vide })]);
    const l = s.exercices[1]!;
    expect(l.ecartBilan).toBeNull();
    expect(l.margeNetteBps).toBeNull();
    expect(l.variationProduitsBps).toBeNull();
    expect(l.variationActifBps).toBeNull();
    expect(codes(s).filter((c) => c === "DONNEE_MANQUANTE")).toHaveLength(5);
  });

  it("marge avec produits nuls : null", () => {
    const s = syntheseEtatsFinanciers([
      etat(2024, { totaux: { actif: 10, passif: 10, charges: 5, produits: 0, resultat: -5 } }),
    ]);
    expect(s.exercices[0]!.margeNetteBps).toBeNull();
  });

  it("alertes : écart de bilan, non conforme, incomplet", () => {
    const s = syntheseEtatsFinanciers([
      etat(2024, {
        totaux: { actif: 1000, passif: 900, charges: 800, produits: 1000, resultat: 200 },
        conforme: false,
        complet: false,
        acceptation: "humaine",
      }),
    ]);
    expect(s.exercices[0]!.ecartBilan).toBe(100);
    expect(s.exercices[0]!.acceptation).toBe("humaine");
    expect(codes(s)).toEqual(["ECART_BILAN", "ETAT_NON_CONFORME", "ETAT_INCOMPLET"]);
    for (const a of s.alertes) {
      expect(CODES_ALERTE_SYNTHESE).toContain(a.code);
      expect(a.message.length).toBeGreaterThan(0);
    }
  });
});
