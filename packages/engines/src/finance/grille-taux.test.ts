import { describe, expect, it } from "vitest";
import { resoudreTauxGrade, type GrilleTaux } from "./grille-taux";
import { montant } from "./monnaie";

const grille: GrilleTaux = {
  standard: {
    associe: montant(600_000, "XOF"),
    consultant: montant(400_000, "XOF"),
  },
  negocies: [
    { clientId: "C1", grade: "consultant", taux: montant(350_000, "XOF") },
    {
      clientId: "C2",
      grade: "consultant",
      taux: montant(380_000, "XOF"),
      valideDu: "2026-01-01",
      valideAu: "2026-06-30",
    },
    { clientId: "C2", grade: "consultant", taux: montant(390_000, "XOF"), valideDu: "2026-04-01" },
    { clientId: "C3", grade: "expert", taux: montant(700_000, "XOF") },
    { clientId: "C4", grade: "associe", taux: montant(550_000, "XOF") },
    { clientId: "C4", grade: "associe", taux: montant(560_000, "XOF") },
  ],
};

describe("resoudreTauxGrade (FIN-02)", () => {
  it("ignore les propriétés héritées d'Object (grade « constructor », « toString »)", () => {
    const tauxInconnu = expect.objectContaining({ code: "TAUX_INCONNU" });
    for (const grade of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => resoudreTauxGrade(grille, { grade, date: "2026-10-06" })).toThrow(tauxInconnu);
    }
    const avecConstructor: GrilleTaux = { standard: { constructor: montant(1, "XOF") } };
    expect(
      resoudreTauxGrade(avecConstructor, { grade: "constructor", date: "2026-10-06" }).taux,
    ).toEqual(montant(1, "XOF"));
  });

  it("rend le taux standard sans négociation", () => {
    expect(resoudreTauxGrade(grille, { grade: "associe", date: "2026-10-06" })).toEqual({
      taux: montant(600_000, "XOF"),
      source: "standard",
    });
    expect(
      resoudreTauxGrade(grille, { grade: "associe", clientId: "C1", date: "2026-10-06" }).source,
    ).toBe("standard");
  });

  it("donne la priorité au taux négocié du client", () => {
    expect(
      resoudreTauxGrade(grille, { grade: "consultant", clientId: "C1", date: "2026-10-06" }),
    ).toEqual({
      taux: montant(350_000, "XOF"),
      source: "negocie",
    });
  });

  it("respecte la période de validité et préfère le taux le plus récent", () => {
    const tauxC2 = (date: string) =>
      resoudreTauxGrade(grille, { grade: "consultant", clientId: "C2", date }).taux.valeur;
    expect(tauxC2("2025-12-31")).toBe(400_000); // aucun négocié encore valide
    expect(tauxC2("2026-02-15")).toBe(380_000);
    expect(tauxC2("2026-05-01")).toBe(390_000); // deux valides : le plus récent
    expect(tauxC2("2026-10-06")).toBe(390_000);
  });

  it("à égalité de début, garde le premier déclaré", () => {
    const r = resoudreTauxGrade(grille, { grade: "associe", clientId: "C4", date: "2026-10-06" });
    expect(r.taux.valeur).toBe(550_000);
  });

  it("accepte un grade connu seulement par négociation, refuse un grade inconnu", () => {
    expect(
      resoudreTauxGrade(grille, { grade: "expert", clientId: "C3", date: "2026-10-06" }).source,
    ).toBe("negocie");
    expect(() => resoudreTauxGrade(grille, { grade: "expert", date: "2026-10-06" })).toThrow(
      expect.objectContaining({ code: "TAUX_INCONNU" }),
    );
    expect(() => resoudreTauxGrade({ standard: {} }, { grade: "x", date: "2026-10-06" })).toThrow(
      /Aucun taux/,
    );
  });
});
