import { describe, expect, it } from "vitest";
import {
  echeanceDepuisDuree,
  syntheseEfficacite,
  type ObservationEfficacite,
} from "./bibliotheque";
import { ErreurPlan } from "./erreurs";

describe("echeanceDepuisDuree", () => {
  it("compte le jour de début (1 jour : échéance le même jour)", () => {
    expect(echeanceDepuisDuree("2027-01-01", 1)).toBe("2027-01-01");
    expect(echeanceDepuisDuree("2027-01-01", 90)).toBe("2027-03-31");
    expect(echeanceDepuisDuree("2028-02-28", 2)).toBe("2028-02-29");
  });

  it("refuse une date ou une durée hors bornes", () => {
    expect(() => echeanceDepuisDuree("2027-02-30", 10)).toThrow(ErreurPlan);
    expect(() => echeanceDepuisDuree("2027-01-01", 0)).toThrow(/Durée/);
    expect(() => echeanceDepuisDuree("2027-01-01", 3651)).toThrow(/Durée/);
    expect(() => echeanceDepuisDuree("2027-01-01", 1.5)).toThrow(/Durée/);
  });
});

const o = (
  efficacite: number,
  secteur: string | null,
  taille: string | null = null,
  pays: string | null = null,
): ObservationEfficacite => ({ efficacite, secteur, taille, pays });

describe("syntheseEfficacite", () => {
  const observations = [
    o(80, "Banque", "pme", "CI"),
    o(70, "banque ", "pme", "CI"),
    o(61, "BANQUE", "pme", "SN"),
    o(40, "banque", "eti", "CI"),
    o(20, "industrie", "pme", "CI"),
    o(90, null),
  ];

  it("retient le contexte le plus précis qui atteint le seuil", () => {
    const r = syntheseEfficacite(observations, { secteur: "Banque", taille: "PME", pays: "ci" });
    expect(r.niveaux.map((n) => [n.niveau, n.observations, n.moyenne, n.mediane])).toEqual([
      ["secteur_taille_pays", 2, 75, 75],
      ["secteur_taille", 3, 70, 70],
      ["secteur", 4, 63, 66],
      ["global", 6, 60, 66],
    ]);
    expect(r.retenue?.niveau).toBe("secteur_taille");
    expect(r.retenue?.minimum).toBe(61);
    expect(r.retenue?.maximum).toBe(80);
    expect(r.seuil).toBe(3);
  });

  it("omet les niveaux dont un critère manque au contexte", () => {
    const r = syntheseEfficacite(observations, { secteur: "industrie", taille: null, pays: "CI" });
    expect(r.niveaux.map((n) => n.niveau)).toEqual(["secteur", "global"]);
    expect(r.retenue?.niveau).toBe("global");
  });

  it("aucune efficacité retenue sous le seuil ; niveau vide sans statistique", () => {
    const r = syntheseEfficacite([], { secteur: "", taille: null, pays: null }, 1);
    expect(r.niveaux).toEqual([
      {
        niveau: "global",
        observations: 0,
        moyenne: null,
        mediane: null,
        minimum: null,
        maximum: null,
      },
    ]);
    expect(r.retenue).toBeNull();
  });

  it("refuse une efficacité ou un seuil hors bornes", () => {
    expect(() =>
      syntheseEfficacite([o(101, null)], { secteur: null, taille: null, pays: null }),
    ).toThrow(/Efficacité/);
    expect(() =>
      syntheseEfficacite([o(5.5, null)], { secteur: null, taille: null, pays: null }),
    ).toThrow(ErreurPlan);
    expect(() => syntheseEfficacite([], { secteur: null, taille: null, pays: null }, 0)).toThrow(
      /Seuil/,
    );
  });
});
