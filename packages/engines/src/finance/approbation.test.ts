import { describe, expect, it } from "vitest";
import {
  GRILLE_SEUILS_PAR_DEFAUT,
  roleApprobateur,
  verifierPaliers,
  type GrilleSeuils,
} from "./approbation";
import { PARITE_EUR_FCFA, figerTauxChange, montant } from "./monnaie";

const xof = (v: number) => montant(v, "XOF");

describe("roleApprobateur (FIN-15), grille par défaut", () => {
  it.each([
    ["facture", 5_000_000, "chef_mission"],
    ["facture", 5_000_001, "directeur_mission"],
    ["facture", 25_000_000, "directeur_mission"],
    ["facture", 25_000_001, "associe"],
    ["remise", 400_000, "chef_mission"],
    ["remise", 2_500_001, "associe"],
    ["revision_budget", 1, "directeur_mission"], // jamais le chef de mission
    ["revision_budget", 10_000_001, "associe"],
    ["revision_budget", -20_000_000, "associe"], // révision à la baisse : valeur absolue
    ["facture", -6_000_000, "directeur_mission"], // avoir
  ] as const)("%s de %d FCFA → %s", (objet, valeur, role) => {
    expect(roleApprobateur({ objet, montant: xof(valeur) })).toBe(role);
  });

  it("convertit dans la devise de référence avec le taux figé", () => {
    // 10 000,00 € × 655,957 = 6 559 570 FCFA → directeur de mission.
    const tauxChange = figerTauxChange("EUR", "XOF", PARITE_EUR_FCFA, "2026-10-06");
    expect(
      roleApprobateur({ objet: "facture", montant: montant(1_000_000, "EUR"), tauxChange }),
    ).toBe("directeur_mission");
  });

  it("exige un taux vers la devise de référence", () => {
    const attendu = expect.objectContaining({ code: "TAUX_CHANGE_INVALIDE" });
    expect(() => roleApprobateur({ objet: "facture", montant: montant(100, "EUR") })).toThrow(
      attendu,
    );
    const mauvaiseCible = figerTauxChange("EUR", "USD", 1.1, "2026-10-06");
    expect(() =>
      roleApprobateur({
        objet: "facture",
        montant: montant(100, "EUR"),
        tauxChange: mauvaiseCible,
      }),
    ).toThrow(attendu);
  });
});

describe("grille paramétrable", () => {
  const grilleEur: GrilleSeuils = {
    deviseReference: "EUR",
    paliers: {
      facture: [
        { plafond: 1_000_000, role: "directeur_mission" },
        { plafond: null, role: "associe" },
      ],
      remise: [{ plafond: null, role: "associe" }],
      revision_budget: [{ plafond: null, role: "associe" }],
    },
  };

  it("applique une grille propre au cabinet", () => {
    expect(
      roleApprobateur({ objet: "facture", montant: montant(1_000_000, "EUR"), grille: grilleEur }),
    ).toBe("directeur_mission");
    expect(
      roleApprobateur({ objet: "remise", montant: montant(1, "EUR"), grille: grilleEur }),
    ).toBe("associe");
  });

  it("refuse une grille incohérente", () => {
    const attendu = expect.objectContaining({ code: "GRILLE_SEUILS_INVALIDE" });
    expect(() => verifierPaliers([])).toThrow(attendu);
    expect(() => verifierPaliers([{ plafond: 10, role: "associe" }])).toThrow(attendu);
    expect(() =>
      verifierPaliers([
        { plafond: 10, role: "chef_mission" },
        { plafond: 10, role: "directeur_mission" },
        { plafond: null, role: "associe" },
      ]),
    ).toThrow(attendu);
    expect(() =>
      verifierPaliers([
        { plafond: -1, role: "chef_mission" },
        { plafond: null, role: "associe" },
      ]),
    ).toThrow(attendu);
    expect(() =>
      verifierPaliers([
        { plafond: null, role: "chef_mission" },
        { plafond: null, role: "associe" },
      ]),
    ).toThrow(attendu);
    Object.values(GRILLE_SEUILS_PAR_DEFAUT.paliers).forEach((p) =>
      expect(() => verifierPaliers(p)).not.toThrow(),
    );
  });
});
