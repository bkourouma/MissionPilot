import { describe, expect, it } from "vitest";
import { annonceChangementPage, focusAReprendre, titreDePage } from "./page";

describe("titreDePage", () => {
  it("retire le suffixe de marque", () => {
    expect(titreDePage("Missions — CabinetPilot")).toBe("Missions");
    expect(titreDePage("Tableau de bord")).toBe("Tableau de bord");
    expect(titreDePage("")).toBe("");
  });
});

describe("annonceChangementPage", () => {
  it("annonce le titre dans la langue de l'interface", () => {
    expect(annonceChangementPage("Missions — CabinetPilot", "fr")).toBe("Page : Missions");
    expect(annonceChangementPage("Missions — CabinetPilot", "en")).toBe("Page: Missions");
  });

  it("n'annonce rien sans titre utile", () => {
    expect(annonceChangementPage("", "fr")).toBe("");
    expect(annonceChangementPage("CabinetPilot", "fr")).toBe("");
  });
});

describe("focusAReprendre", () => {
  it("reprend le focus quand il est perdu", () => {
    expect(focusAReprendre({ surDocument: true, dansChampSaisie: false })).toBe(true);
  });

  it("laisse le focus au rail, au menu, aux onglets ou à un champ en cours de saisie", () => {
    expect(focusAReprendre({ surDocument: false, dansChampSaisie: false })).toBe(false);
    expect(focusAReprendre({ surDocument: true, dansChampSaisie: true })).toBe(false);
    expect(focusAReprendre({ surDocument: false, dansChampSaisie: true })).toBe(false);
  });
});
