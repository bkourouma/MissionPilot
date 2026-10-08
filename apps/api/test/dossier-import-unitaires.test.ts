import { describe, expect, it } from "vitest";
import { lettresColonne, lireEtatDepuisTableau, normaliser } from "../src/dossier/import-etats.js";

/** Lecture d'un état financier depuis un tableau (CSV ou Excel), sans base. */
describe("lecture d'un état financier depuis un tableau", () => {
  it("normalise les en-têtes et les valeurs", () => {
    expect(normaliser(" Libellé ")).toBe("libelle");
    expect(normaliser("Résultat de l'exercice")).toBe("resultat_de_l_exercice");
    expect(normaliser("Résultat net")).toBe("resultat_net");
  });

  it("nomme les colonnes Excel", () => {
    expect([1, 4, 26, 27, 52, 703].map(lettresColonne)).toEqual(["A", "D", "Z", "AA", "AZ", "AAA"]);
  });

  it("lit sections, rôles en toutes lettres, parents et montants en centimes", () => {
    const l = lireEtatDepuisTableau(
      {
        entete: ["Code", "Section", "Libellé", "Montant", "Parent", "Rôle"],
        lignes: [
          {
            numero: 2,
            valeurs: ["CJ", "Passif", "Résultat", "1 234,56", "", "Résultat de l'exercice"],
          },
          { numero: 3, valeurs: ["XI", "Résultat", "Net", "(12,5)", "", "Résultat net"] },
          { numero: 4, valeurs: ["A1", "actif", "Stocks", "10", "AZ", ""] },
        ],
      },
      "EUR",
      { format: "excel", fichier: "liasse.xlsx" },
    );
    expect(l.erreurs).toEqual([]);
    expect(l.lignes.map((x) => [x.code, x.section, x.montant, x.role, x.parent])).toEqual([
      ["CJ", "passif", 123456, "resultat_exercice", null],
      ["XI", "resultat", -1250, "resultat_net", null],
      ["A1", "actif", 1000, null, "AZ"],
    ]);
    expect(l.lignes[0]?.reference).toEqual({ fichier: "liasse.xlsx", cellule: "D2", ligne: 2 });
  });

  it("rapporte chaque ligne en erreur, et les cas globaux", () => {
    const entete = ["section", "code", "libelle", "montant", "parent", "role"];
    const l = lireEtatDepuisTableau(
      {
        entete,
        lignes: [
          { numero: 2, valeurs: ["actif", "x y", "A", "1"] },
          { numero: 3, valeurs: ["actif", "A", "", "1"] },
          { numero: 4, valeurs: ["actif", "A", "L", "1", "p q"] },
          { numero: 5, valeurs: ["actif", "A", "L", "1", "", "autre"] },
          { numero: 6, valeurs: ["actif", "A", "L", "1,5"] },
          {
            numero: 7,
            valeurs: ["actif", "A", "L", "1"],
            erreurs: [undefined, undefined, undefined, "Cellule D7 : nombre invalide."],
          },
        ],
      },
      "XOF",
      { format: "csv", fichier: null },
    );
    expect(l.erreurs.map((e) => e.ligne)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(l.erreurs[5]?.message).toBe("Cellule D7 : nombre invalide.");
    expect(
      lireEtatDepuisTableau({ entete, lignes: [] }, "XOF", { format: "csv", fichier: null })
        .erreurs[0]?.message,
    ).toBe("Aucune ligne de données.");
    const trop = Array.from({ length: 1001 }, (_, i) => ({
      numero: i + 2,
      valeurs: ["actif", `A${i}`, "L", "1"],
    }));
    expect(
      lireEtatDepuisTableau({ entete, lignes: trop }, "XOF", { format: "csv", fichier: null })
        .erreurs,
    ).toHaveLength(1);
  });
});
