import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  type BaseLevier,
  CATALOGUE_LEVIERS,
  CODES_LEVIER,
  type CodeLevier,
  VERSION_CATALOGUE_LEVIERS,
  calculerImpactLevier,
} from "./leviers";
import { POSTES_RATIO_REDRESSEMENT } from "./ratios";

const BASE_A: BaseLevier = {
  devise: "XOF",
  postes: { chiffre_affaires: 1_200_000_000, stocks: 120_000_000, cout_ventes: 780_000_000 },
};

const erreur = (f: () => unknown): ErreurRedressement => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e;
    throw e;
  }
  throw new Error("aucune erreur levée");
};

describe("impact des leviers (base A)", () => {
  it("(L1) délai clients : CA × jours / 360, un seul arrondi", () => {
    const r = calculerImpactLevier("reduction_delai_clients", { joursGagnes: 10 }, BASE_A);
    expect(r).toMatchObject({
      code: "reduction_delai_clients",
      devise: "XOF",
      tresorerieUnique: 33_333_333,
      resultatAnnuel: 0,
      tresorerieAnnee1: 33_333_333,
      plusOuMoinsValue: null,
      base: { chiffre_affaires: 1_200_000_000 },
      versionCatalogue: 1,
    });
    expect(r.hypotheses.length).toBeGreaterThan(0);
  });

  it("(L2) stocks : 1500 pb de 120 M", () => {
    const r = calculerImpactLevier("reduction_stocks", { reductionPb: 1500 }, BASE_A);
    expect(r).toMatchObject({
      tresorerieUnique: 18_000_000,
      tresorerieAnnee1: 18_000_000,
      base: { stocks: 120_000_000 },
    });
  });

  it("(L3) délai fournisseurs : coût des ventes × jours / 360", () => {
    const r = calculerImpactLevier("allongement_delai_fournisseurs", { joursGagnes: 15 }, BASE_A);
    expect(r).toMatchObject({ tresorerieUnique: 32_500_000, base: { cout_ventes: 780_000_000 } });
  });

  it("(L4) charges fixes : gain annuel et effet de la première année", () => {
    const r = calculerImpactLevier(
      "reduction_charges_fixes",
      { chargesFixesAnnuelles: 300_000_000, reductionPb: 1000, moisMiseEnOeuvre: 3 },
      { devise: "XOF", postes: {} },
    );
    expect(r).toMatchObject({
      resultatAnnuel: 30_000_000,
      tresorerieAnnee1: 22_500_000,
      tresorerieUnique: 0,
      base: {},
    });
    const immediat = calculerImpactLevier(
      "reduction_charges_fixes",
      { chargesFixesAnnuelles: 300_000_000, reductionPb: 1000, moisMiseEnOeuvre: 0 },
      { devise: "XOF", postes: {} },
    );
    expect(immediat.tresorerieAnnee1).toBe(30_000_000);
    const tard = calculerImpactLevier(
      "reduction_charges_fixes",
      { chargesFixesAnnuelles: 300_000_000, reductionPb: 1000, moisMiseEnOeuvre: 12 },
      { devise: "XOF", postes: {} },
    );
    expect(tard.tresorerieAnnee1).toBe(0);
  });

  it("charges fixes : un seul arrondi, sur la fraction exacte de chaque résultat", () => {
    // 1 000 × 1 pb = 0,1 → annuel 0 ; année 1 : 0,1 × 5 / 12 = 0,0417 → 0.
    const r = calculerImpactLevier(
      "reduction_charges_fixes",
      { chargesFixesAnnuelles: 1_000, reductionPb: 5, moisMiseEnOeuvre: 7 },
      { devise: "EUR", postes: {} },
    );
    expect(r).toMatchObject({ devise: "EUR", resultatAnnuel: 1 });
    // 0,5 → 1 ; 0,5 × 11/12 = 0,458 → 0 : l'année 1 est arrondie depuis la fraction exacte.
    expect(r.tresorerieAnnee1).toBe(0);
  });

  it("(L5) hausse de prix : +500 pb, perte de volume 200 pb", () => {
    const r = calculerImpactLevier("hausse_prix", { hausseParPb: 500, perteVolumePb: 200 }, BASE_A);
    expect(r).toMatchObject({
      resultatAnnuel: 50_400_000,
      tresorerieAnnee1: 50_400_000,
      tresorerieUnique: 0,
      base: { chiffre_affaires: 1_200_000_000, cout_ventes: 780_000_000 },
    });
  });

  it("(L6) cession : trésorerie nette des frais et plus-value", () => {
    const r = calculerImpactLevier(
      "cession_actif",
      { prixCession: 80_000_000, valeurComptableNette: 50_000_000, fraisEtImpots: 4_000_000 },
      { devise: "XOF", postes: {} },
    );
    expect(r).toMatchObject({
      tresorerieUnique: 76_000_000,
      tresorerieAnnee1: 76_000_000,
      plusOuMoinsValue: 30_000_000,
      resultatAnnuel: 0,
    });
    const moinsValue = calculerImpactLevier(
      "cession_actif",
      { prixCession: 10, valeurComptableNette: 50, fraisEtImpots: 0 },
      { devise: "XOF", postes: {} },
    );
    expect(moinsValue.plusOuMoinsValue).toBe(-40);
  });

  it("(L8) arrondi demi s'éloignant de zéro ; un gain négatif reste négatif", () => {
    const r = calculerImpactLevier(
      "reduction_delai_clients",
      { joursGagnes: 1 },
      { devise: "XOF", postes: { chiffre_affaires: 540 } },
    );
    expect(r.tresorerieUnique).toBe(2);
    const negatif = calculerImpactLevier(
      "hausse_prix",
      { hausseParPb: 1, perteVolumePb: 9999 },
      BASE_A,
    );
    expect(negatif.resultatAnnuel).toBeLessThan(0);
    // (1 − 0,9999) × (CA × 1,0001 − CV) − (CA − CV) = 0,0001 × 420 120 000 − 420 000 000 = 42 012 − 420 000 000.
    expect(negatif.resultatAnnuel).toBe(42_012 - 420_000_000);
  });

  it("la devise du résultat est celle de la base ; la base est un instantané (copie)", () => {
    const eur = calculerImpactLevier(
      "reduction_stocks",
      { reductionPb: 100 },
      { ...BASE_A, devise: "EUR" },
    );
    expect(eur.devise).toBe("EUR");
    expect(eur.base).toEqual({ stocks: 120_000_000 });
  });
});

describe("(L7) erreurs", () => {
  it("paramètres hors bornes, non entiers, absents ou inconnus", () => {
    const jours = (joursGagnes: number) => () =>
      calculerImpactLevier("reduction_delai_clients", { joursGagnes }, BASE_A);
    expect(erreur(jours(0)).code).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(erreur(jours(181)).code).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(erreur(jours(1.5)).code).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(() => jours(1)()).not.toThrow();
    expect(() => jours(180)()).not.toThrow();
    expect(
      erreur(() => calculerImpactLevier("reduction_stocks", { reductionPb: 10_001 }, BASE_A)).code,
    ).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(
      erreur(() =>
        calculerImpactLevier(
          "reduction_charges_fixes",
          { chargesFixesAnnuelles: 1, reductionPb: 1, moisMiseEnOeuvre: 13 },
          BASE_A,
        ),
      ).code,
    ).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(
      erreur(() =>
        calculerImpactLevier("hausse_prix", { hausseParPb: 5001, perteVolumePb: 0 }, BASE_A),
      ).code,
    ).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(
      erreur(() =>
        calculerImpactLevier("hausse_prix", { hausseParPb: 1, perteVolumePb: 10_000 }, BASE_A),
      ).code,
    ).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(erreur(() => calculerImpactLevier("reduction_stocks", {} as never, BASE_A)).code).toBe(
      "PARAMETRES_LEVIER_INVALIDES",
    );
    expect(
      erreur(() =>
        calculerImpactLevier("reduction_stocks", { reductionPb: 1, autre: 2 } as never, BASE_A),
      ).code,
    ).toBe("PARAMETRES_LEVIER_INVALIDES");
    expect(erreur(() => calculerImpactLevier("reduction_stocks", null as never, BASE_A)).code).toBe(
      "PARAMETRES_LEVIER_INVALIDES",
    );
    // Cession : frais > prix.
    expect(
      erreur(() =>
        calculerImpactLevier(
          "cession_actif",
          { prixCession: 10, valeurComptableNette: 0, fraisEtImpots: 11 },
          BASE_A,
        ),
      ),
    ).toMatchObject({ code: "PARAMETRES_LEVIER_INVALIDES", manquants: ["fraisEtImpots"] });
  });

  it("poste de base absent : BASE_INCOMPLETE avec la liste des postes", () => {
    const e = erreur(() =>
      calculerImpactLevier(
        "reduction_delai_clients",
        { joursGagnes: 10 },
        { devise: "XOF", postes: {} },
      ),
    );
    expect(e.code).toBe("BASE_INCOMPLETE");
    expect(e.manquants).toEqual(["chiffre_affaires"]);
    const deux = erreur(() =>
      calculerImpactLevier(
        "hausse_prix",
        { hausseParPb: 1, perteVolumePb: 0 },
        { devise: "XOF", postes: { stocks: 1 } },
      ),
    );
    expect(deux.manquants).toEqual(["chiffre_affaires", "cout_ventes"]);
  });

  it("devise de base absente ou inconnue : BASE_INCOMPLETE", () => {
    const sansDevise = erreur(() =>
      calculerImpactLevier("reduction_stocks", { reductionPb: 1 }, {
        postes: { stocks: 1 },
      } as never),
    );
    expect(sansDevise).toMatchObject({ code: "BASE_INCOMPLETE", manquants: ["devise"] });
    expect(
      erreur(() =>
        calculerImpactLevier("reduction_stocks", { reductionPb: 1 }, {
          devise: "GBP",
          postes: { stocks: 1 },
        } as never),
      ).code,
    ).toBe("BASE_INCOMPLETE");
  });

  it("levier inconnu : LEVIER_INCONNU", () => {
    expect(erreur(() => calculerImpactLevier("inconnu" as never, {} as never, BASE_A)).code).toBe(
      "LEVIER_INCONNU",
    );
  });

  it("résultat hors des limites : SOMME_HORS_LIMITES", () => {
    const aberrante: BaseLevier = {
      devise: "XOF",
      postes: { chiffre_affaires: Number.MAX_SAFE_INTEGER, cout_ventes: -Number.MAX_SAFE_INTEGER },
    };
    expect(
      erreur(() =>
        calculerImpactLevier("hausse_prix", { hausseParPb: 5000, perteVolumePb: 9999 }, aberrante),
      ).code,
    ).toBe("SOMME_HORS_LIMITES");
  });
});

describe("(L9) catalogue", () => {
  it("six entrées, codes uniques, postes de base connus, bornes cohérentes", () => {
    expect(CATALOGUE_LEVIERS).toHaveLength(6);
    expect(CATALOGUE_LEVIERS.map((d) => d.code)).toEqual([...CODES_LEVIER]);
    expect(new Set(CATALOGUE_LEVIERS.map((d) => d.code)).size).toBe(6);
    for (const d of CATALOGUE_LEVIERS) {
      for (const poste of d.postesBase) expect(POSTES_RATIO_REDRESSEMENT).toContain(poste);
      expect(d.parametres.length).toBeGreaterThan(0);
      for (const p of d.parametres) expect(p.min).toBeLessThanOrEqual(p.max);
      expect(d.hypotheses.length).toBeGreaterThan(0);
      expect(d.libelle).not.toBe("");
      expect(d.description).not.toBe("");
    }
    expect(VERSION_CATALOGUE_LEVIERS).toBe(1);
  });

  it("chaque levier se calcule avec des paramètres pris dans ses propres bornes", () => {
    const base: BaseLevier = { devise: "XOF", postes: { ...BASE_A.postes } };
    for (const d of CATALOGUE_LEVIERS) {
      const parametres = Object.fromEntries(
        d.parametres.map((p) => [p.cle, Math.min(p.max, p.min + 1)]),
      );
      const r = calculerImpactLevier(d.code as CodeLevier, parametres as never, base);
      expect(r.code).toBe(d.code);
      expect(r.versionCatalogue).toBe(1);
    }
  });

  it("aucun libellé du catalogue ne qualifie la situation en termes juridiques", () => {
    const texte = JSON.stringify(CATALOGUE_LEVIERS).toLowerCase();
    for (const interdit of ["cessation des paiements", "faillite", "défaillance"]) {
      expect(texte).not.toContain(interdit);
    }
  });
});
