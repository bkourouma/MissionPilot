import { describe, expect, it } from "vitest";
import { ErreurDossier } from "../dossier/erreurs";
import {
  lireMontantIsole,
  lireMontantsDansTexte,
  montantPresentDansTexte,
  nombresNonRetrouves,
  reperer,
  resteAcceptable,
} from "./montants";

describe("lireMontantsDansTexte", () => {
  it("lit les séparateurs de milliers courants (FCFA, 0 décimale)", () => {
    expect(lireMontantsDansTexte("1 500 000", 0)).toEqual([1_500_000]);
    expect(lireMontantsDansTexte("1.500.000", 0)).toEqual([1_500_000]);
    expect(lireMontantsDansTexte("1 500 000", 0)).toEqual([1_500_000]);
    expect(lireMontantsDansTexte("1'500'000", 0)).toEqual([1_500_000]);
    expect(lireMontantsDansTexte("1,500,000", 0)).toEqual([1_500_000]);
    expect(lireMontantsDansTexte("1.500", 0)).toEqual([1500]);
    expect(lireMontantsDansTexte("12345", 0)).toEqual([12345]);
  });

  it("lit les décimales en EUR (2 décimales) en unités mineures", () => {
    expect(lireMontantsDansTexte("1 234,56", 2)).toEqual([123_456]);
    expect(lireMontantsDansTexte("1.234,56", 2)).toEqual([123_456]);
    expect(lireMontantsDansTexte("1,234.56", 2)).toEqual([123_456]);
    expect(lireMontantsDansTexte("1 500", 2)).toEqual([150_000]);
    expect(lireMontantsDansTexte("12,5", 2)).toEqual([1250]);
    expect(lireMontantsDansTexte("1.500", 2)).toEqual([150_000]);
    expect(lireMontantsDansTexte("0,500", 3)).toEqual([500]);
  });

  it("lit les négatifs : parenthèses, signe collé, signe typographique", () => {
    expect(lireMontantsDansTexte("(12 000)", 0)).toEqual([-12_000]);
    expect(lireMontantsDansTexte("-300", 0)).toEqual([-300]);
    expect(lireMontantsDansTexte("Perte −300", 0)).toEqual([-300]);
    expect(lireMontantsDansTexte("(-300)", 0)).toEqual([-300]);
    expect(lireMontantsDansTexte("(0)", 0)).toEqual([0]);
    expect(lireMontantsDansTexte("N-1", 0)).toEqual([1]);
    expect(lireMontantsDansTexte("5 - 300", 0)).toEqual([5, 300]);
  });

  it("sépare deux colonnes par deux espaces ou davantage", () => {
    expect(lireMontantsDansTexte("Terrains   1 500 000   1 200 000", 0)).toEqual([
      1_500_000, 1_200_000,
    ]);
    expect(lireMontantsDansTexte("Terrains 1 500 000 1 200 000", 0)).toEqual([
      1_500_000, 1_200_000,
    ]);
  });

  it("ignore sans exception un jeton illisible, trop précis ou collé à un identifiant", () => {
    expect(lireMontantsDansTexte("12,34 puis 7", 0)).toEqual([7]);
    expect(lireMontantsDansTexte("1,234.567 et 9", 2)).toEqual([900]);
    expect(lireMontantsDansTexte("1.234.56", 0)).toEqual([]);
    expect(lireMontantsDansTexte("TA1 L2_5 12", 0)).toEqual([12]);
    expect(lireMontantsDansTexte("9".repeat(41), 0)).toEqual([]);
    expect(lireMontantsDansTexte("", 0)).toEqual([]);
    expect(lireMontantsDansTexte("aucun nombre ici", 0)).toEqual([]);
  });

  it("refuse un nombre de décimales invalide", () => {
    expect(() => lireMontantsDansTexte("1", 5)).toThrow(ErreurDossier);
    expect(() => lireMontantsDansTexte("1", 1.5)).toThrow(ErreurDossier);
  });

  it.each([
    ["une ligne de 100 000 chiffres", "1".repeat(100_000)],
    ["une ligne de 100 000 nombres isolés", "1 ".repeat(50_000)],
    ["des parenthèses imbriquées", "(".repeat(100_000) + "5" + ")".repeat(100_000)],
    ["un texte de 400 000 caractères", "Terrains 1 500 000 1 200 000 ".repeat(14_000)],
  ])("tolère %s en moins d'une seconde", (_nom, texte) => {
    const debut = performance.now();
    lireMontantsDansTexte(texte, 0);
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("reperer et lireMontantIsole", () => {
  it("donne les positions, signe et parenthèses compris", () => {
    const [a, b] = reperer("Total (12 000) et -300", 0);
    expect(a).toMatchObject({ debut: 6, fin: 14, valeur: -12_000, simple: false });
    expect(b).toMatchObject({ debut: 18, fin: 22, valeur: -300, simple: true });
  });

  it("lit un montant isolé, avec monnaie ou appel de note", () => {
    expect(lireMontantIsole(" 1 500 000 ", 0)).toBe(1_500_000);
    expect(lireMontantIsole("1 500 FCFA", 0)).toBe(1500);
    expect(lireMontantIsole("12,50 €", 2)).toBe(1250);
    expect(lireMontantIsole("(12 000)", 0)).toBe(-12_000);
    expect(lireMontantIsole("100 (a)", 0)).toBe(100);
    expect(lireMontantIsole("100 *", 0)).toBe(100);
    expect(lireMontantIsole("", 0)).toBeNull();
    expect(lireMontantIsole("abc", 0)).toBeNull();
    expect(lireMontantIsole("12 et 13", 0)).toBeNull();
    expect(lireMontantIsole("A 12", 0)).toBeNull();
    expect(lireMontantIsole("12 pommes", 0)).toBeNull();
    expect(lireMontantIsole("12,34", 0)).toBeNull();
    expect(lireMontantIsole("9".repeat(61), 0)).toBeNull();
  });

  it("n'accepte comme reste que monnaie, étoiles ou appel de note", () => {
    expect(resteAcceptable("")).toBe(true);
    expect(resteAcceptable(" F CFA ")).toBe(true);
    expect(resteAcceptable("**")).toBe(true);
    expect(resteAcceptable("(1)")).toBe(true);
    expect(resteAcceptable("(abcde)")).toBe(false);
    expect(resteAcceptable("texte")).toBe(false);
    expect(resteAcceptable("x".repeat(20))).toBe(false);
  });
});

describe("montantPresentDansTexte", () => {
  it("compare les valeurs absolues", () => {
    expect(montantPresentDansTexte(-12_000, "Report à nouveau (12 000) (9 000)", 0)).toBe(true);
    expect(montantPresentDansTexte(12_000, "Report 12 000", 0)).toBe(true);
    expect(montantPresentDansTexte(12_000, "Report (12 000)", 0)).toBe(true);
    expect(montantPresentDansTexte(12_001, "Report (12 000)", 0)).toBe(false);
    expect(montantPresentDansTexte(123_456, "Solde 1 234,56 €", 2)).toBe(true);
    expect(montantPresentDansTexte(5, "", 0)).toBe(false);
  });

  it("ne confond pas un nombre plus long avec un montant", () => {
    expect(montantPresentDansTexte(500, "Capital 1 500 000", 0)).toBe(false);
    expect(montantPresentDansTexte(1_500_000, "Capital 1 500 000", 0)).toBe(true);
  });
});

describe("nombresNonRetrouves", () => {
  it("rend les nombres absents de la source, séparateurs retirés", () => {
    const source = "Chiffre d'affaires 2025 : 1 500 000 FCFA, effectif 120 personnes.";
    expect(nombresNonRetrouves("CA de 1.500.000 en 2025 pour 120 salariés", source)).toEqual([]);
    expect(nombresNonRetrouves("CA de 1 600 000 en 2024", source)).toEqual(["1600000", "2024"]);
  });

  it("ignore les nombres de moins de 3 chiffres et dédoublonne", () => {
    expect(nombresNonRetrouves("note 12, lot 3, 9999 et 9999", "rien")).toEqual(["9999"]);
  });

  it("retrouve les sous-nombres de colonnes collées et les nombres collés à des lettres", () => {
    expect(nombresNonRetrouves("500 000", "Terrains 500 000 120 000")).toEqual([]);
    expect(nombresNonRetrouves("120 000", "Terrains 500 000 120 000")).toEqual([]);
    expect(nombresNonRetrouves("ISO 9001", "norme ISO9001")).toEqual([]);
    expect(nombresNonRetrouves("1234", "1 234,56")).toEqual([]);
    expect(nombresNonRetrouves("1".repeat(70), "1".repeat(70))).toEqual(["1".repeat(70)]);
  });

  it("traite un texte de 400 000 caractères en moins d'une seconde", () => {
    const source = "Total 1 234 567 FCFA, exercice 2025. ".repeat(11_000);
    const debut = performance.now();
    expect(nombresNonRetrouves("1234567 et 2025 et 777777", source)).toEqual(["777777"]);
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("colonnes collées par des espaces simples", () => {
  it("découpe sans équivoque deux ou trois colonnes", () => {
    expect(lireMontantsDansTexte("Terrains 350 000 300 000", 0)).toEqual([350_000, 300_000]);
    expect(lireMontantsDansTexte("Résultat 1 050 000 800 000", 0)).toEqual([1_050_000, 800_000]);
    expect(lireMontantsDansTexte("Divers 350 000 300 000 120 000", 0)).toEqual([
      350_000, 300_000, 120_000,
    ]);
    const [a, b] = reperer("Terrains 350 000 300 000", 0);
    expect(a).toMatchObject({ debut: 9, fin: 16 });
    expect(b).toMatchObject({ debut: 17, fin: 24 });
  });

  it("garde un seul nombre marqué ambigu quand le découpage est douteux", () => {
    const [grand] = reperer("Dépôts 1 200 300 400", 0);
    expect(grand).toMatchObject({ valeur: 1_200_300_400, ambigu: true });
    expect(reperer("Capital 10 500 000 000", 0)[0]).toMatchObject({
      valeur: 10_500_000_000,
      ambigu: false,
    });
    expect(reperer("Tout 100 200 300 400 500", 0)).toHaveLength(1);
    expect(reperer("Négatif (350 000 300 000)", 0)[0]?.valeur).toBe(-350_000_300_000);
  });

  it("vérifie un montant contre les valeurs possibles d'un nombre ambigu", () => {
    const texte = "Dépôts 1 200 300 400";
    expect(montantPresentDansTexte(1_200_300_400, texte, 0)).toBe(true);
    expect(montantPresentDansTexte(1200, texte, 0)).toBe(true);
    expect(montantPresentDansTexte(300_400, texte, 0)).toBe(true);
    expect(montantPresentDansTexte(1300, texte, 0)).toBe(false);
  });
});
