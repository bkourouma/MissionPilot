import { describe, expect, it } from "vitest";
import {
  formaterDate,
  formaterDateHeure,
  formaterJours,
  formaterMontant,
  formaterNombre,
  formaterPourcentage,
  lireDate,
  VALEUR_ABSENTE,
} from "./format";

/** Remplace les espaces insécables par des espaces simples pour des attentes lisibles. */
const lisible = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formaterMontant", () => {
  it("affiche le franc CFA sans décimales, avec séparateur de milliers", () => {
    expect(lisible(formaterMontant(1_500_000, "XOF"))).toBe("1 500 000 FCFA");
    expect(lisible(formaterMontant(1_500_000, "XAF"))).toBe("1 500 000 FCFA");
    expect(lisible(formaterMontant(1_499.6, "XOF"))).toBe("1 500 FCFA");
  });

  it("utilise XOF par défaut", () => {
    expect(lisible(formaterMontant(250_000))).toBe("250 000 FCFA");
  });

  it("affiche euro et dollar avec deux décimales", () => {
    expect(lisible(formaterMontant(1500.5, "EUR"))).toBe("1 500,50 €");
    expect(lisible(formaterMontant(1500, "USD"))).toBe("1 500,00 $US");
  });

  it("utilise des espaces insécables (pas de coupure de ligne dans un montant)", () => {
    expect(formaterMontant(1_500_000, "XOF")).not.toMatch(/ /);
  });

  it("gère les négatifs et zéro", () => {
    expect(lisible(formaterMontant(0, "XOF"))).toBe("0 FCFA");
    expect(lisible(formaterMontant(-25_000, "XOF"))).toBe("-25 000 FCFA");
  });

  it("renvoie un tiret pour une valeur absente ou invalide", () => {
    expect(formaterMontant(null)).toBe(VALEUR_ABSENTE);
    expect(formaterMontant(undefined)).toBe(VALEUR_ABSENTE);
    expect(formaterMontant(Number.NaN)).toBe(VALEUR_ABSENTE);
    expect(formaterMontant(Number.POSITIVE_INFINITY)).toBe(VALEUR_ABSENTE);
  });
});

describe("formaterJours", () => {
  it("affiche les jours avec virgule décimale", () => {
    expect(lisible(formaterJours(2.5))).toBe("2,5 j");
    expect(lisible(formaterJours(1))).toBe("1 j");
    expect(lisible(formaterJours(0.25))).toBe("0,25 j");
    expect(lisible(formaterJours(1250))).toBe("1 250 j");
  });

  it("arrondit à deux décimales au plus", () => {
    expect(lisible(formaterJours(1 / 3))).toBe("0,33 j");
  });

  it("renvoie un tiret pour une valeur absente", () => {
    expect(formaterJours(null)).toBe(VALEUR_ABSENTE);
  });
});

describe("formaterNombre et formaterPourcentage", () => {
  it("formate en fr-FR", () => {
    expect(lisible(formaterNombre(1234567.891))).toBe("1 234 567,89");
    expect(lisible(formaterPourcentage(0.125))).toBe("12,5 %");
    expect(lisible(formaterPourcentage(1.05))).toBe("105 %");
  });
});

describe("formaterDate", () => {
  it("affiche le jour, le mois abrégé et l'année", () => {
    expect(formaterDate("2027-01-12")).toBe("12 janv. 2027");
    expect(formaterDate(new Date(Date.UTC(2026, 9, 6)))).toBe("6 oct. 2026");
  });

  it("ne décale pas une date seule, quel que soit le fuseau du serveur", () => {
    expect(formaterDate("2027-12-31")).toBe("31 déc. 2027");
    expect(formaterDate("2027-01-01")).toBe("1 janv. 2027");
  });

  it("accepte un horodatage ISO et un fuseau", () => {
    // 23 h 30 UTC le 31 janvier = 1er février 0 h 30 à Douala (UTC+1).
    expect(formaterDate("2027-01-31T23:30:00Z", "Africa/Douala")).toBe("1 févr. 2027");
    expect(formaterDate("2027-01-31T23:30:00Z", "Africa/Abidjan")).toBe("31 janv. 2027");
  });

  it("renvoie un tiret pour une date absente ou invalide", () => {
    expect(formaterDate(null)).toBe(VALEUR_ABSENTE);
    expect(formaterDate("")).toBe(VALEUR_ABSENTE);
    expect(formaterDate("pas une date")).toBe(VALEUR_ABSENTE);
    expect(lireDate(new Date(Number.NaN))).toBeNull();
  });
});

describe("formaterDateHeure", () => {
  it("ajoute l'heure dans le fuseau", () => {
    expect(formaterDateHeure("2027-01-12T14:05:00Z")).toBe("12 janv. 2027 à 14:05");
    expect(formaterDateHeure("2027-01-12T14:05:00Z", "Africa/Douala")).toBe(
      "12 janv. 2027 à 15:05",
    );
  });
});
