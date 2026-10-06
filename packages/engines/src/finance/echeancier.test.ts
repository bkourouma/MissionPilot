import { describe, expect, it } from "vitest";
import {
  calculerEcheancier,
  controlerEcheancierBudget,
  echeancierAbonnement,
  echeancierForfait,
  echeancierForfaitVariable,
  echeancierRegie,
  type DefinitionEcheancier,
  type JalonFacturation,
} from "./echeancier";
import { montant } from "./monnaie";

const xof = (v: number) => montant(v, "XOF");
const jalons = (...pourcentages: number[]): JalonFacturation[] =>
  pourcentages.map((pourcentage, i) => ({
    libelle: `Jalon ${i + 1}`,
    pourcentage,
    date: `2026-1${i}-01`,
  }));

describe("forfait (acomptes et jalons)", () => {
  it("répartit 10 000 000 FCFA en 30/40/30", () => {
    const e = echeancierForfait(xof(10_000_000), jalons(30, 40, 30));
    expect(e.map((x) => x.montant.valeur)).toEqual([3_000_000, 4_000_000, 3_000_000]);
    expect(e[1]).toMatchObject({ libelle: "Jalon 2", date: "2026-11-01" });
  });

  it("accepte des pourcentages décimaux sommant exactement à 100, sans perte", () => {
    // 33,33 % de 100 = 33,33 → 33 ; le reste (34) va au dernier jalon.
    expect(
      echeancierForfait(xof(100), jalons(33.33, 33.33, 33.34)).map((x) => x.montant.valeur),
    ).toEqual([33, 33, 34]);
  });

  it("refuse des pourcentages invalides", () => {
    const attendu = expect.objectContaining({ code: "POURCENTAGES_INVALIDES" });
    expect(() => echeancierForfait(xof(100), jalons(33.33, 33.33, 33.33))).toThrow(attendu);
    expect(() => echeancierForfait(xof(100), jalons(0, 100))).toThrow(attendu);
    expect(() => echeancierForfait(xof(100), jalons(110, -10))).toThrow(attendu);
    expect(() => echeancierForfait(xof(100), [])).toThrow(attendu);
    expect(() =>
      echeancierForfait(xof(100), [{ libelle: "x", pourcentage: 100, date: "2026-02-30" }]),
    ).toThrow(expect.objectContaining({ code: "DATE_INVALIDE" }));
  });
});

describe("régie sur temps validés", () => {
  it("facture jours × taux par période, triée par date", () => {
    const e = echeancierRegie([
      { periode: "2026-10-31", jours: 3, tauxJournalier: xof(400_000) },
      { periode: "2026-09-30", jours: 2.5, tauxJournalier: xof(350_000) },
      { periode: "2026-10-31", jours: 0.5, tauxJournalier: xof(350_000) },
    ]);
    expect(e).toEqual([
      { libelle: "Régie — période du 2026-09-30", date: "2026-09-30", montant: xof(875_000) },
      { libelle: "Régie — période du 2026-10-31", date: "2026-10-31", montant: xof(1_375_000) },
    ]);
    expect(echeancierRegie([])).toEqual([]);
  });
});

describe("forfait avec part variable", () => {
  const definition = {
    mode: "forfait_variable" as const,
    partFixe: xof(8_000_000),
    jalons: jalons(50, 50),
    partVariable: {
      libelle: "Prime de résultat",
      montantMaximum: xof(2_000_000),
      atteinte: 75,
      date: "2027-03-31",
    },
  };

  it("ajoute la part variable selon l'atteinte", () => {
    const e = echeancierForfaitVariable(definition);
    expect(e.map((x) => x.montant.valeur)).toEqual([4_000_000, 4_000_000, 1_500_000]);
    expect(e[2]?.libelle).toBe("Prime de résultat");
  });

  it("refuse une atteinte hors de [0 ; 100]", () => {
    const avecAtteinte = (atteinte: number) => () =>
      echeancierForfaitVariable({
        ...definition,
        partVariable: { ...definition.partVariable, atteinte },
      });
    const attendu = expect.objectContaining({ code: "ECHEANCIER_INVALIDE" });
    expect(avecAtteinte(120)).toThrow(attendu);
    expect(avecAtteinte(-1)).toThrow(attendu);
  });
});

describe("abonnement", () => {
  const base = {
    mode: "abonnement" as const,
    libelle: "Assistance",
    montantPeriodique: xof(500_000),
    dateDebut: "2026-01-31",
    nombrePeriodes: 3,
    periodicite: "mensuelle" as const,
  };

  it("génère des échéances égales, fin de mois respectée", () => {
    const e = echeancierAbonnement(base);
    expect(e.map((x) => x.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(e.every((x) => x.montant.valeur === 500_000)).toBe(true);
    expect(e[2]?.libelle).toBe("Assistance — période 3/3");
  });

  it("gère les autres périodicités", () => {
    expect(
      echeancierAbonnement({ ...base, periodicite: "trimestrielle" }).map((x) => x.date),
    ).toEqual(["2026-01-31", "2026-04-30", "2026-07-31"]);
    expect(
      echeancierAbonnement({ ...base, periodicite: "semestrielle", nombrePeriodes: 2 })[1]?.date,
    ).toBe("2026-07-31");
    expect(
      echeancierAbonnement({ ...base, periodicite: "annuelle", nombrePeriodes: 2 })[1]?.date,
    ).toBe("2027-01-31");
  });

  it("refuse un nombre de périodes invalide", () => {
    const attendu = expect.objectContaining({ code: "ECHEANCIER_INVALIDE" });
    expect(() => echeancierAbonnement({ ...base, nombrePeriodes: 0 })).toThrow(attendu);
    expect(() => echeancierAbonnement({ ...base, nombrePeriodes: 1.5 })).toThrow(attendu);
  });
});

describe("calculerEcheancier et contrôle du budget signé", () => {
  const definitions: DefinitionEcheancier[] = [
    { mode: "forfait", montant: xof(1_000_000), jalons: jalons(100) },
    { mode: "regie", temps: [{ periode: "2026-10-31", jours: 1, tauxJournalier: xof(1_000_000) }] },
    {
      mode: "forfait_variable",
      partFixe: xof(800_000),
      jalons: jalons(100),
      partVariable: {
        libelle: "Variable",
        montantMaximum: xof(200_000),
        atteinte: 100,
        date: "2027-01-01",
      },
    },
    {
      mode: "abonnement",
      libelle: "Abonnement",
      montantPeriodique: xof(250_000),
      dateDebut: "2026-10-01",
      nombrePeriodes: 4,
      periodicite: "mensuelle",
    },
  ];

  it.each(definitions)("mode $mode : total 1 000 000 FCFA", (definition) => {
    const controle = controlerEcheancierBudget(calculerEcheancier(definition), xof(1_000_000));
    expect(controle).toEqual({ conforme: true, total: xof(1_000_000), depassement: xof(0) });
  });

  it("signale un dépassement du budget signé", () => {
    const e = calculerEcheancier(definitions[0] as DefinitionEcheancier);
    expect(controlerEcheancierBudget(e, xof(900_000))).toEqual({
      conforme: false,
      total: xof(1_000_000),
      depassement: xof(100_000),
    });
    expect(() => controlerEcheancierBudget(e, montant(1, "EUR"))).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });
});
