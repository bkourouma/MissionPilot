import { describe, expect, it } from "vitest";
import { formaterMontantMineur, formaterPourcentage } from "./format";
import {
  formaterEcart,
  formaterEcartRelatif,
  formaterHypothese,
  formaterValeurComparee,
  LIBELLES_SENS,
  lignesEcartsSerie,
  lignesHypotheses,
  sensEcart,
  tableauxSynthese,
} from "./plan-comparaison";

describe("comparaison : mise en forme des écarts du moteur", () => {
  it("sens de l'écart", () => {
    expect(sensEcart(5)).toBe("hausse");
    expect(sensEcart(-5)).toBe("baisse");
    expect(sensEcart(0)).toBe("stable");
    expect(sensEcart(null)).toBe("indetermine");
    expect(LIBELLES_SENS.stable).toBe("inchangé");
  });

  it("écarts signés selon la nature", () => {
    expect(formaterEcart("montant", 2_000_000, "XOF")).toBe(
      `+${formaterMontantMineur(2_000_000, "XOF")}`,
    );
    expect(formaterEcart("montant", -2_000_000, "XOF")).toBe(
      `−${formaterMontantMineur(2_000_000, "XOF")}`,
    );
    expect(formaterEcart("montant", 0, "XOF")).toBe(formaterMontantMineur(0, "XOF"));
    expect(formaterEcart("taux", 0.015, "XOF")).toBe("+1,5 pt");
    expect(formaterEcart("taux", -0.02, "XOF")).toBe("−2 pt");
    expect(formaterEcart("nombre", 2, "XOF")).toBe("+2");
    expect(formaterEcart("nombre", null, "XOF")).toBe("—");
    expect(formaterEcartRelatif(0.0182)).toBe(`+${formaterPourcentage(0.018, 1)}`);
    expect(formaterEcartRelatif(-0.25)).toBe(`−${formaterPourcentage(0.25, 1)}`);
    expect(formaterEcartRelatif(null)).toBe("—");
  });

  it("valeurs selon la nature", () => {
    expect(formaterValeurComparee("montant", 100, "XOF")).toBe(formaterMontantMineur(100, "XOF"));
    expect(formaterValeurComparee("taux", 0.125, "XOF")).toBe(formaterPourcentage(0.125, 2));
    expect(formaterValeurComparee("nombre", 3, "XOF")).toBe("3");
    expect(formaterValeurComparee("nombre", null, "XOF")).toBe("—");
  });

  it("lignes d'une série et tableaux de synthèse", () => {
    const serie = {
      cle: "chiffre_affaires",
      libelle: "Chiffre d'affaires",
      de: [],
      a: [],
      points: [{ exercice: 2027, de: 100, a: 120, ecart: 20, ecart_relatif: 0.2 }],
    };
    expect(lignesEcartsSerie(serie, "XOF")).toEqual([
      {
        cle: "2027",
        libelle: "2027",
        de: formaterMontantMineur(100, "XOF"),
        a: formaterMontantMineur(120, "XOF"),
        ecart: `+${formaterMontantMineur(20, "XOF")}`,
        relatif: `+${formaterPourcentage(0.2, 1)}`,
        sens: "hausse",
      },
    ]);
    expect(lignesEcartsSerie({ ...serie, points: undefined }, "XOF")).toEqual([]);
    const t = tableauxSynthese(
      {
        synthese: [
          {
            scenario: "pessimiste",
            indicateurs: [
              {
                cle: "taux_rendement_interne",
                libelle: "Taux de rendement interne",
                nature: "taux",
                de: 0.12,
                a: 0.1,
                ecart: -0.02,
                ecart_relatif: null,
              },
            ],
          },
        ],
      },
      "XOF",
    );
    expect(t[0]).toMatchObject({ scenario: "pessimiste", titre: "Scénario pessimiste" });
    expect(t[0]!.lignes[0]).toMatchObject({
      de: formaterPourcentage(0.12, 2),
      a: formaterPourcentage(0.1, 2),
      ecart: "−2 pt",
      relatif: "—",
    });
    expect(tableauxSynthese({}, "XOF")).toEqual([]);
  });

  it("hypothèses modifiées avec leurs valeurs", () => {
    expect(formaterHypothese(10)).toBe("10");
    expect(formaterHypothese([12, 10, 8])).toBe("12 / 10 / 8");
    expect(formaterHypothese([{ a: 1 }])).toBe("1 élément");
    expect(formaterHypothese([{ a: 1 }, { a: 2 }])).toBe("2 éléments");
    expect(formaterHypothese(null)).toBe("non renseignée");
    expect(formaterHypothese("x")).toBe("x");
    expect(formaterHypothese({ a: 1 })).toBe("valeurs détaillées");
    const l = lignesHypotheses({
      hypotheses_modifiees: ["croissanceChiffreAffaires", "tauxMargeBrute"],
      hypotheses_detail: [{ chemin: "croissanceChiffreAffaires", de: 10, a: [12, 10, 8] }],
    });
    expect(l[0]).toMatchObject({ de: "10", a: "12 / 10 / 8" });
    expect(l[1]).toMatchObject({ chemin: "tauxMargeBrute", de: null, a: null });
    expect(l[0]!.libelle).not.toBe("croissanceChiffreAffaires");
  });
});
