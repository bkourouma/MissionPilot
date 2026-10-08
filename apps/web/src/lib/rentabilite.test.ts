import { describe, expect, it } from "vitest";
import {
  encoursValorise,
  lireFiltresRentabilite,
  OPTIONS_NIVEAUX_RENTABILITE,
  requeteRentabilite,
} from "./rentabilite";

describe("rentabilité", () => {
  it("propose les quatre regroupements du PRD", () => {
    expect(OPTIONS_NIVEAUX_RENTABILITE.map((o) => o.valeur)).toEqual([
      "mission",
      "client",
      "type",
      "associe",
    ]);
  });

  it("lit les filtres, depuis le début de l'année par défaut", () => {
    expect(lireFiltresRentabilite({}, "2027-05-20")).toEqual({
      du: "2027-01-01",
      au: "2027-05-20",
      niveau: "mission",
      corrigee: false,
    });
    const f = lireFiltresRentabilite(
      { niveau: "client", du: "2027-02-01", au: "2027-02-28" },
      "2027-05-20",
    );
    expect(requeteRentabilite(f)).toBe("niveau=client&du=2027-02-01&au=2027-02-28");
    expect(lireFiltresRentabilite({ niveau: "x" }, "2027-05-20").niveau).toBe("mission");
    expect(
      lireFiltresRentabilite({ du: "2025-01-01", au: "2026-12-31" }, "2027-05-20"),
    ).toMatchObject({ du: "2027-01-01", au: "2027-05-20", corrigee: true });
  });
});

describe("encours", () => {
  it("ne considère la valorisation servie que si le champ est présent", () => {
    expect(encoursValorise({ encours_production: 0 })).toBe(true);
    expect(encoursValorise({})).toBe(false);
  });
});
