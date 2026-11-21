import { describe, expect, it } from "vitest";
import {
  ariaSort,
  classeAlignement,
  classes,
  hrefTri,
  lireSens,
  sensDeColonne,
  sensSuivant,
} from "./Tableau.tri";

describe("sensSuivant", () => {
  it("alterne croissant, décroissant, aucun", () => {
    expect(sensSuivant(null)).toBe("asc");
    expect(sensSuivant("asc")).toBe("desc");
    expect(sensSuivant("desc")).toBeNull();
  });
});

describe("ariaSort", () => {
  it("traduit le sens en valeur ARIA", () => {
    expect(ariaSort("asc")).toBe("ascending");
    expect(ariaSort("desc")).toBe("descending");
    expect(ariaSort(null)).toBe("none");
  });
});

describe("lireSens et sensDeColonne", () => {
  it("n'accepte que asc et desc", () => {
    expect(lireSens("asc")).toBe("asc");
    expect(lireSens("DESC")).toBeNull();
    expect(lireSens(undefined)).toBeNull();
  });
  it("ne porte le sens que sur la colonne triée", () => {
    expect(sensDeColonne("nom", "nom", "desc")).toBe("desc");
    expect(sensDeColonne("nom", "date", "desc")).toBeNull();
    expect(sensDeColonne("nom", null, "asc")).toBeNull();
  });
});

describe("hrefTri", () => {
  it("passe en croissant et retire la page en gardant les filtres", () => {
    expect(hrefTri("/clients?q=a&page=3", "nom", null)).toBe("/clients?q=a&tri=nom&sens=asc");
  });
  it("passe en décroissant", () => {
    expect(hrefTri("/clients?tri=nom&sens=asc", "nom", "asc")).toBe("/clients?tri=nom&sens=desc");
  });
  it("retire le tri au troisième clic", () => {
    expect(hrefTri("/clients?q=a&tri=nom&sens=desc", "nom", "desc")).toBe("/clients?q=a");
    expect(hrefTri("/clients?tri=nom&sens=desc", "nom", "desc")).toBe("/clients");
  });
  it("retire aussi le curseur et accepte d'autres noms de paramètres", () => {
    expect(hrefTri("/m?curseur=zz", "jours", null, { paramTri: "t", paramSens: "s" })).toBe(
      "/m?t=jours&s=asc",
    );
  });
  it("remplace la colonne triée quand on trie une autre colonne", () => {
    expect(hrefTri("/c?tri=date&sens=desc", "nom", null)).toBe("/c?tri=nom&sens=asc");
  });
});

describe("classeAlignement et classes", () => {
  it("donne la classe d'alignement", () => {
    expect(classeAlignement("droite")).toBe("mp-aligne-droite");
    expect(classeAlignement("centre")).toBe("mp-aligne-centre");
    expect(classeAlignement("gauche")).toBeUndefined();
    expect(classeAlignement(undefined)).toBeUndefined();
  });
  it("assemble les classes non vides", () => {
    expect(classes("a", false, null, undefined, "", "b")).toBe("a b");
  });
});
