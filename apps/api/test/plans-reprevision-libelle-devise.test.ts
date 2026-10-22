import { describe, expect, it } from "vitest";
import type { ResultatReprevision } from "@missionpilot/engines";
import { libelleDeviseAffichage, texteReprevision } from "../src/plans/reprevision-explication.js";

const resultat = {
  methode: "reste_du_plan",
  trimestresRealises: 1,
  faits: [{ libelle: "Chiffre d'affaires réalisé", montant: 1000 }],
  reprevision: {
    chiffreAffaires: 5000,
    excedentBrutExploitation: null,
    resultatNet: 300,
    tresorerieCloture: 200,
  },
} as unknown as ResultatReprevision;

describe("devise affichée dans l'explication du plan vivant (recette A-08)", () => {
  it("affiche FCFA pour XOF et XAF, sans toucher aux autres devises", () => {
    expect(libelleDeviseAffichage("XOF")).toBe("FCFA");
    expect(libelleDeviseAffichage("XAF")).toBe("FCFA");
    expect(libelleDeviseAffichage("EUR")).toBe("EUR");
  });
  it("le texte du gabarit ne contient plus le code XOF", () => {
    const t = texteReprevision(resultat, 2027, "XOF");
    expect(t).toContain("FCFA");
    expect(t).not.toContain("XOF");
  });
});
