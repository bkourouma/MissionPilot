import { describe, expect, it } from "vitest";
import {
  calculerOffreFinanciere,
  ErreurOffreFinanciere,
  joursDepuisCentiemes,
  OFFRE_FINANCIERE_LIGNES_MAX,
  type EntreeOffreFinanciere,
} from "./index";

const BASE: EntreeOffreFinanciere = {
  devise: "XOF",
  honoraires: [
    { cle: "chef", libelle: "Chef d'équipe", jours: 20, tauxJournalier: 450_000 },
    { cle: "expert", libelle: "Expert finances publiques", jours: 12.5, tauxJournalier: 350_000 },
    { cle: "chef", libelle: "Chef d'équipe", jours: 2.5, tauxJournalier: 450_000 },
  ],
  perDiem: [{ libelle: "Per diem mission terrain", quantite: 10, prixUnitaire: 45_000 }],
  debours: [{ libelle: "Billets d'avion", quantite: 2, prixUnitaire: 650_000 }],
  taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht" }],
};

const erreur = (code: string) => expect.objectContaining({ code });

describe("offre financière : calcul nominal", () => {
  it("lignes, sous-totaux, taxes et totaux exacts en FCFA", () => {
    const r = calculerOffreFinanciere(BASE);
    expect(r.honoraires.map((l) => l.montant)).toEqual([9_000_000, 4_375_000, 1_125_000]);
    expect(r.sousTotalHonoraires).toBe(14_500_000);
    expect(r.sousTotalPerDiem).toBe(450_000);
    expect(r.sousTotalDebours).toBe(1_300_000);
    expect(r.totalHt).toBe(16_250_000);
    expect(r.taxes[0]).toMatchObject({ base: 16_250_000, montant: 2_925_000 });
    expect(r.totalTaxes).toBe(2_925_000);
    expect(r.totalTtc).toBe(19_175_000);
    expect(r.conversion).toBeNull();
  });

  it("jours par expert regroupés par clé, en centièmes exacts", () => {
    const r = calculerOffreFinanciere(BASE);
    expect(r.joursParExpert).toEqual([
      { cle: "chef", libelle: "Chef d'équipe", joursCentiemes: 2250, montant: 10_125_000 },
      {
        cle: "expert",
        libelle: "Expert finances publiques",
        joursCentiemes: 1250,
        montant: 4_375_000,
      },
    ]);
    expect(r.totalJoursCentiemes).toBe(3500);
    expect(joursDepuisCentiemes(r.totalJoursCentiemes)).toBe(35);
  });

  it("arrondi unique par ligne, demi s'éloignant de zéro (centimes d'euro)", () => {
    const r = calculerOffreFinanciere({
      devise: "EUR",
      honoraires: [{ cle: "a", libelle: "Expert", jours: 0.5, tauxJournalier: 33_333 }],
      perDiem: [],
      debours: [{ libelle: "Reprographie", quantite: 0.33, prixUnitaire: 1001 }],
      taxes: [{ libelle: "Taxe", taux: 7.5, assiette: "honoraires" }],
    });
    // 0,5 × 333,33 € = 166,665 € → 166,67 € ; 0,33 × 10,01 € = 3,3033 € → 3,30 €.
    expect(r.honoraires[0]?.montant).toBe(16_667);
    expect(r.debours[0]?.montant).toBe(330);
    // Taxe sur les seuls honoraires : 7,5 % de 166,67 € = 12,50025 € → 12,50 €.
    expect(r.taxes[0]).toMatchObject({ base: 16_667, montant: 1250 });
    expect(r.totalTtc).toBe(16_667 + 330 + 1250);
  });

  it("sans taxe ni honoraires : total TTC = total HT", () => {
    const r = calculerOffreFinanciere({
      devise: "USD",
      honoraires: [],
      perDiem: [{ libelle: "Per diem", quantite: 3, prixUnitaire: 15_000 }],
      debours: [],
      taxes: [],
    });
    expect(r.totalHt).toBe(45_000);
    expect(r.totalTtc).toBe(45_000);
    expect(r.joursParExpert).toEqual([]);
  });

  it("conversion à taux figé : EUR vers XOF à la parité", () => {
    const r = calculerOffreFinanciere({
      devise: "EUR",
      honoraires: [{ cle: "a", libelle: "Expert", jours: 1, tauxJournalier: 100_000 }],
      perDiem: [],
      debours: [],
      taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht" }],
      conversion: { deviseCible: "XOF", taux: 655.957, dateFixation: "2026-10-01" },
    });
    expect(r.conversion).toEqual({
      deviseCible: "XOF",
      taux: 655.957,
      dateFixation: "2026-10-01",
      totalHt: 655_957,
      totalTtc: 774_029,
    });
  });
});

describe("offre financière : entrées refusées", () => {
  const avec = (extra: Partial<EntreeOffreFinanciere>) => () =>
    calculerOffreFinanciere({ ...BASE, ...extra });

  it("offre vide", () => {
    expect(avec({ honoraires: [], perDiem: [], debours: [] })).toThrow(erreur("OFFRE_VIDE"));
  });

  it("jours ou quantités négatifs, à trois décimales ou démesurés", () => {
    for (const jours of [-1, 1.234, 100_001, Number.NaN]) {
      expect(avec({ honoraires: [{ cle: "a", libelle: "x", jours, tauxJournalier: 1 }] })).toThrow(
        erreur("QUANTITE_INVALIDE"),
      );
    }
    expect(avec({ debours: [{ libelle: "x", quantite: 0.001, prixUnitaire: 1 }] })).toThrow(
      ErreurOffreFinanciere,
    );
  });

  it("prix non entier ou négatif", () => {
    for (const prixUnitaire of [-5, 10.5]) {
      expect(avec({ perDiem: [{ libelle: "x", quantite: 1, prixUnitaire }] })).toThrow(
        erreur("PRIX_INVALIDE"),
      );
    }
  });

  it("taux de taxe hors bornes ou trop précis", () => {
    for (const taux of [-1, 101, 18.00001]) {
      expect(avec({ taxes: [{ libelle: "TVA", taux, assiette: "total_ht" }] })).toThrow(
        erreur("TAXE_INVALIDE"),
      );
    }
    const taxes = Array.from({ length: 11 }, () => ({
      libelle: "t",
      taux: 1,
      assiette: "total_ht" as const,
    }));
    expect(avec({ taxes })).toThrow(erreur("TROP_DE_LIGNES"));
  });

  it("trop de lignes", () => {
    const debours = Array.from({ length: OFFRE_FINANCIERE_LIGNES_MAX + 1 }, () => ({
      libelle: "x",
      quantite: 1,
      prixUnitaire: 1,
    }));
    expect(avec({ debours })).toThrow(erreur("TROP_DE_LIGNES"));
  });

  it("conversion invalide : taux nul, date invalide, même devise à un autre taux", () => {
    expect(
      avec({ conversion: { deviseCible: "EUR", taux: 0, dateFixation: "2026-10-01" } }),
    ).toThrow(erreur("CONVERSION_INVALIDE"));
    expect(
      avec({ conversion: { deviseCible: "EUR", taux: 0.0015, dateFixation: "2026-02-30" } }),
    ).toThrow(erreur("CONVERSION_INVALIDE"));
    expect(
      avec({ conversion: { deviseCible: "XOF", taux: 2, dateFixation: "2026-10-01" } }),
    ).toThrow(erreur("CONVERSION_INVALIDE"));
  });

  it("montant au-delà du calcul exact", () => {
    expect(
      avec({
        honoraires: [
          { cle: "a", libelle: "x", jours: 100_000, tauxJournalier: Number.MAX_SAFE_INTEGER },
        ],
      }),
    ).toThrow(erreur("MONTANT_HORS_LIMITES"));
  });

  it("une erreur inattendue n'est pas masquée", () => {
    const piege = {
      ...BASE,
      get taxes(): never {
        throw new TypeError("piège");
      },
    } as unknown as EntreeOffreFinanciere;
    expect(() => calculerOffreFinanciere(piege)).toThrow(TypeError);
  });
});
