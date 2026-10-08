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
    expect(respectJalons(jalons, "2024-03-31")).toEqual({ reussis: 1, attendus: 3, taux: 0.3333 });
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

  it("n'attend un jalon non atteint qu'à partir du lendemain de sa date (+ tolérance)", () => {
    const enCours = [{ datePrevue: "2024-03-20" }];
    expect(respectJalons(enCours, "2024-03-20").attendus).toBe(0);
    expect(respectJalons(enCours, "2024-03-21")).toEqual({ reussis: 0, attendus: 1, taux: 0 });
    expect(respectJalons(enCours, "2024-03-22", 2).attendus).toBe(0);
    expect(respectJalons(enCours, "2024-03-23", 2).attendus).toBe(1);
  });

  it("compte un jalon atteint dès qu'il est atteint, même avant sa date prévue", () => {
    const enAvance = [{ datePrevue: "2024-03-20", dateReelle: "2024-03-10" }];
    expect(respectJalons(enAvance, "2024-03-12")).toEqual({ reussis: 1, attendus: 1, taux: 1 });
    expect(respectJalons(enAvance, "2024-03-09").attendus).toBe(0);
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

  it("n'attend une feuille non soumise qu'à partir du lendemain de sa date limite", () => {
    const feuille = [{ dateLimite: "2024-01-05" }];
    expect(disciplineSaisie(feuille, "2024-01-05")).toEqual({
      reussis: 0,
      attendus: 0,
      taux: null,
    });
    expect(disciplineSaisie(feuille, "2024-01-06")).toEqual({ reussis: 0, attendus: 1, taux: 0 });
  });

  it("compte une feuille soumise dès sa soumission, et arrondit le taux à 4 décimales", () => {
    const feuilles = [
      { dateLimite: "2024-01-12", dateSoumission: "2024-01-10" },
      { dateLimite: "2024-01-05", dateSoumission: "2024-01-08" },
      { dateLimite: "2024-01-04" },
    ];
    expect(disciplineSaisie(feuilles, "2024-01-10")).toEqual({
      reussis: 1,
      attendus: 3,
      taux: 0.3333,
    });
    // Soumission postérieure à la date courante : pas encore réalisée.
    expect(disciplineSaisie(feuilles.slice(0, 1), "2024-01-09").attendus).toBe(0);
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
