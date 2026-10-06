import { describe, expect, it } from "vitest";
import * as finance from "./index";

describe("API publique du domaine finance", () => {
  it("expose les moteurs de chaque module", () => {
    const attendues = [
      "ErreurFinance",
      "montant",
      "convertir",
      "formaterMontant",
      "repartir",
      "resoudreTauxGrade",
      "calculerBudget",
      "comparerVersions",
      "creerRevision",
      "calculerMarge",
      "encoursMission",
      "agregerRentabilite",
      "balanceAgee",
      "calculerFacture",
      "creerAvoir",
      "calculerEcheancier",
      "controlerEcheancierBudget",
      "roleApprobateur",
    ];
    attendues.forEach((nom) => expect(finance).toHaveProperty(nom));
  });

  it("enchaîne budget signé, échéancier et approbation sur un même exemple", () => {
    const xof = (v: number) => finance.montant(v, "XOF");
    const budget = finance.figerVersion(
      {
        id: "v1",
        numero: 1,
        type: "initial",
        devise: "XOF",
        figee: false,
        lignes: [
          {
            id: "h",
            libelle: "Consultant",
            nature: "honoraires",
            valeur: { type: "jours", jours: 20, prixJournalier: xof(400_000) },
          },
        ],
      },
      "2026-10-06",
    );
    const honoraires = finance.calculerBudget(budget).honoraires;
    const echeances = finance.calculerEcheancier({
      mode: "forfait",
      montant: honoraires,
      jalons: [
        { libelle: "Acompte", pourcentage: 30, date: "2026-10-06" },
        { libelle: "Solde", pourcentage: 70, date: "2026-12-15" },
      ],
    });
    expect(finance.controlerEcheancierBudget(echeances, honoraires).conforme).toBe(true);
    expect(finance.formaterMontant(honoraires)).toBe("8 000 000 FCFA");
    expect(finance.roleApprobateur({ objet: "facture", montant: honoraires })).toBe(
      "directeur_mission",
    );
  });
});
