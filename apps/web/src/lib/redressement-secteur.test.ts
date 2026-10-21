import { describe, expect, it } from "vitest";
import { RED_SECTEURS } from "@missionpilot/shared";
import {
  CORRESPONDANCE_SECTEURS_CLIENT,
  secteurRedressementDepuisClient as depuis,
} from "./redressement-secteur";

describe("secteurRedressementDepuisClient", () => {
  it("retient les correspondances sûres, sans tenir compte de la casse ni des accents", () => {
    expect(depuis("Agro-industrie")).toBe("agriculture");
    expect(depuis("  AGRICULTURE ")).toBe("agriculture");
    expect(depuis("Bâtiment et travaux publics")).toBe("btp");
    expect(depuis("Industrie")).toBe("industrie");
    expect(depuis("Commerce de détail")).toBe("commerce");
    expect(depuis("Transport et logistique")).toBe("services");
    expect(depuis("Microfinance")).toBe("services");
  });

  it("retombe sur « général » sans correspondance sûre", () => {
    expect(depuis(null)).toBe("general");
    expect(depuis(undefined)).toBe("general");
    expect(depuis("")).toBe("general");
    expect(depuis("   ")).toBe("general");
    expect(depuis("Divers")).toBe("general");
    expect(depuis("Immobilier")).toBe("general");
    // Deux secteurs possibles : ambigu.
    expect(depuis("Commerce et services")).toBe("general");
    // Un mot-clé n'est reconnu que comme mot entier.
    expect(depuis("Servicesque")).toBe("general");
  });

  it("ne propose que des secteurs du redressement", () => {
    for (const { secteur, motsCles } of CORRESPONDANCE_SECTEURS_CLIENT) {
      expect(RED_SECTEURS).toContain(secteur);
      for (const m of motsCles) expect(depuis(m)).toBe(secteur);
    }
  });
});
