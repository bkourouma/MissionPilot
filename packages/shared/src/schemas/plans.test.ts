import { describe, expect, it } from "vitest";
import {
  DEPENDANCES_INITIATIVE_MAX,
  DONNEES_ELEMENT_PLAN,
  planNotationLienSchema,
  planRecalageSchema,
} from "./plans";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3_MAJ = "ABCDEFAB-1111-4111-8111-ABCDEFABCDEF";

const initiative = { titre: "CRM", echeance: "2027-06-30", budget: 1_000 };

describe("initiative : dépendances (PLA-05)", () => {
  it("accepte une liste d'identifiants, absente par défaut", () => {
    expect(DONNEES_ELEMENT_PLAN.initiative.parse(initiative).dependances).toBeUndefined();
    expect(
      DONNEES_ELEMENT_PLAN.initiative.parse({ ...initiative, dependances: [U1, U2] }).dependances,
    ).toEqual([U1, U2]);
  });

  it("refuse un identifiant mal formé et une liste trop longue", () => {
    expect(
      DONNEES_ELEMENT_PLAN.initiative.safeParse({ ...initiative, dependances: ["x"] }).success,
    ).toBe(false);
    const trop = Array.from({ length: DEPENDANCES_INITIATIVE_MAX + 1 }, () => U1);
    expect(
      DONNEES_ELEMENT_PLAN.initiative.safeParse({ ...initiative, dependances: trop }).success,
    ).toBe(false);
  });
});

describe("planRecalageSchema", () => {
  it("exige au moins une initiative, sans doublon", () => {
    expect(planRecalageSchema.parse({ initiatives: [U1] })).toEqual({ initiatives: [U1] });
    expect(planRecalageSchema.safeParse({ initiatives: [] }).success).toBe(false);
    expect(planRecalageSchema.safeParse({ initiatives: [U1, U1] }).success).toBe(false);
    // Même identifiant écrit en majuscules puis en minuscules : un doublon.
    expect(
      planRecalageSchema.safeParse({ initiatives: [U3_MAJ, U3_MAJ.toLowerCase()] }).success,
    ).toBe(false);
    expect(planRecalageSchema.safeParse({ initiatives: [U1], autre: 1 }).success).toBe(false);
  });
});

describe("planNotationLienSchema", () => {
  it("accepte une version de notation ou null (retrait du lien)", () => {
    expect(planNotationLienSchema.parse({ notation_version_id: U1 }).notation_version_id).toBe(U1);
    expect(planNotationLienSchema.parse({ notation_version_id: null }).notation_version_id).toBe(
      null,
    );
    expect(planNotationLienSchema.safeParse({}).success).toBe(false);
    expect(planNotationLienSchema.safeParse({ notation_version_id: "x" }).success).toBe(false);
  });
});
