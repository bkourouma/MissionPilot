import { describe, expect, it } from "vitest";
import { disciplineSaisie, estDateSaisieModifiable, respectJalons } from "./discipline";

describe("respect des jalons", () => {
  const jalons = [
    { datePrevue: "2024-03-01", dateReelle: "2024-02-28" }, // tenu en avance
    { datePrevue: "2024-03-15", dateReelle: "2024-03-18" }, // en retard
    { datePrevue: "2024-03-20" }, // non atteint
    { datePrevue: "2024-04-30", dateReelle: null }, // pas encore prévu
  ];

  it("rapporte jalons tenus / jalons prévus à la date courante", () => {
    expect(respectJalons(jalons, "2024-03-31")).toEqual({ reussis: 1, attendus: 3, taux: 1 / 3 });
  });

  it("accepte une tolérance en jours calendaires", () => {
    expect(respectJalons(jalons, "2024-03-31", 3).reussis).toBe(2);
  });

  it("ignore une date réelle postérieure à la date courante", () => {
    expect(
      respectJalons([{ datePrevue: "2024-03-01", dateReelle: "2024-03-01" }], "2024-03-01").taux,
    ).toBe(1);
    expect(
      respectJalons([{ datePrevue: "2024-03-01", dateReelle: "2024-03-01" }], "2024-02-28").taux,
    ).toBeNull();
    expect(
      respectJalons([{ datePrevue: "2024-03-01", dateReelle: "2024-03-05" }], "2024-03-02", 10)
        .reussis,
    ).toBe(0);
  });

  it("renvoie null sans jalon attendu", () => {
    expect(respectJalons([], "2024-01-01")).toEqual({ reussis: 0, attendus: 0, taux: null });
  });
});

describe("discipline de saisie", () => {
  it("compte les feuilles soumises dans les délais parmi les feuilles attendues", () => {
    const feuilles = [
      { dateLimite: "2024-01-05", dateSoumission: "2024-01-05" },
      { dateLimite: "2024-01-12", dateSoumission: "2024-01-15" },
      { dateLimite: "2024-01-19", dateSoumission: null },
      { dateLimite: "2024-01-26" },
      { dateLimite: "2024-02-02" }, // pas encore attendue
    ];
    expect(disciplineSaisie(feuilles, "2024-01-30")).toEqual({
      reussis: 1,
      attendus: 4,
      taux: 0.25,
    });
    expect(disciplineSaisie(feuilles, "2024-01-01").taux).toBeNull();
  });
});

describe("clôture de période (TPS-09)", () => {
  it("verrouille les dates des mois clôturés", () => {
    const clotures = { moisClotures: ["2024-01"] };
    expect(estDateSaisieModifiable("2024-01-31", clotures)).toBe(false);
    expect(estDateSaisieModifiable("2024-02-01", clotures)).toBe(true);
  });

  it("verrouille les périodes explicites", () => {
    const clotures = { periodesCloturees: [{ debut: "2024-03-01", fin: "2024-03-15" }] };
    expect(estDateSaisieModifiable("2024-03-15", clotures)).toBe(false);
    expect(estDateSaisieModifiable("2024-03-16", clotures)).toBe(true);
    expect(estDateSaisieModifiable("2024-03-16", {})).toBe(true);
  });

  it("refuse une date ou une clôture invalide", () => {
    expect(() => estDateSaisieModifiable("2024-02-30", {})).toThrow(RangeError);
    expect(() =>
      estDateSaisieModifiable("2024-03-01", {
        periodesCloturees: [{ debut: "2024-03-02", fin: "2024-03-01" }],
      }),
    ).toThrow(/inversée/);
    expect(() => estDateSaisieModifiable("2024-03-01", { moisClotures: ["2024-3"] })).toThrow(
      /Mois/,
    );
  });
});
