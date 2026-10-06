import { describe, expect, it } from "vitest";
import {
  decouperListe,
  joindreListe,
  lireMontant,
  lireNombre,
  montantUsuel,
  montantVersSaisie,
  texteOuNull,
} from "./saisie";

describe("lireNombre", () => {
  it("lit la virgule décimale et les espaces de milliers", () => {
    expect(lireNombre("2,5")).toBe(2.5);
    expect(lireNombre("1 500")).toBe(1500);
    expect(lireNombre("1 500,25")).toBe(1500.25);
    expect(lireNombre(" 8 ")).toBe(8);
  });

  it("renvoie null pour un champ vide et NaN pour un texte illisible", () => {
    expect(lireNombre("")).toBeNull();
    expect(lireNombre("   ")).toBeNull();
    expect(lireNombre("abc")).toBeNaN();
    expect(lireNombre("1,2,3")).toBeNaN();
    expect(lireNombre("1e5")).toBeNaN();
  });
});

describe("lireMontant (vers unités mineures de l'API)", () => {
  it("garde le franc CFA entier", () => {
    expect(lireMontant("150 000", "XOF")).toBe(150_000);
    expect(lireMontant("150000", "XAF")).toBe(150_000);
    expect(lireMontant("1500,5", "XOF")).toBeNaN();
  });

  it("convertit l'euro et le dollar en centimes", () => {
    expect(lireMontant("1 234,50", "EUR")).toBe(123_450);
    expect(lireMontant("0,1", "USD")).toBe(10);
    expect(lireMontant("1,234", "EUR")).toBeNaN();
  });

  it("refuse un montant négatif ou illisible, accepte le vide", () => {
    expect(lireMontant("-5", "XOF")).toBeNaN();
    expect(lireMontant("dix", "XOF")).toBeNaN();
    expect(lireMontant("", "EUR")).toBeNull();
  });

  it("fait l'aller-retour avec montantVersSaisie", () => {
    expect(montantVersSaisie(123_450, "EUR")).toBe("1234,5");
    expect(lireMontant(montantVersSaisie(123_450, "EUR"), "EUR")).toBe(123_450);
    expect(montantVersSaisie(150_000, "XOF")).toBe("150000");
    expect(montantVersSaisie(null, "XOF")).toBe("");
    expect(montantUsuel(5, "USD")).toBe(0.05);
  });
});

describe("listes et textes", () => {
  it("découpe sur virgule, point-virgule ou retour à la ligne, sans doublon ni vide", () => {
    expect(decouperListe("audit, finance ;RH\nfinance, ,")).toEqual(["audit", "finance", "RH"]);
    expect(decouperListe("")).toEqual([]);
    expect(joindreListe(["a", "b"])).toBe("a, b");
    expect(joindreListe(null)).toBe("");
  });

  it("transforme un texte vide en null", () => {
    expect(texteOuNull("  ")).toBeNull();
    expect(texteOuNull(" SA ")).toBe("SA");
  });
});
