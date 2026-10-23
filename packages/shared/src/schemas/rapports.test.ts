import { describe, expect, it } from "vitest";
import { rapportEtatFinancierCorpsSchema, rapportEtatFinancierQuerySchema } from "./rapports";

const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("rapportEtatFinancierQuerySchema", () => {
  it("applique 3 exercices par défaut", () => {
    expect(rapportEtatFinancierQuerySchema.parse({ format: "pdf", mission_id: ID })).toEqual({
      format: "pdf",
      mission_id: ID,
      exercices: 3,
    });
  });

  it("convertit le nombre d'exercices de la query string", () => {
    expect(
      rapportEtatFinancierQuerySchema.parse({ format: "docx", mission_id: ID, exercices: "5" })
        .exercices,
    ).toBe(5);
  });

  it("refuse format, mission, bornes et clés inconnues", () => {
    const base = { format: "pdf", mission_id: ID };
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, format: "xls" }).success).toBe(
      false,
    );
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, mission_id: "x" }).success).toBe(
      false,
    );
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, exercices: "0" }).success).toBe(
      false,
    );
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, exercices: "6" }).success).toBe(
      false,
    );
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, exercices: "2.5" }).success).toBe(
      false,
    );
    expect(rapportEtatFinancierQuerySchema.safeParse({ ...base, autre: 1 }).success).toBe(false);
  });
});

describe("rapportEtatFinancierCorpsSchema", () => {
  it("accepte un corps vide ou un commentaire de 1 à 4000 caractères", () => {
    expect(rapportEtatFinancierCorpsSchema.safeParse({}).success).toBe(true);
    expect(rapportEtatFinancierCorpsSchema.safeParse({ commentaire: "ok" }).success).toBe(true);
    expect(
      rapportEtatFinancierCorpsSchema.safeParse({ commentaire: "a".repeat(4000) }).success,
    ).toBe(true);
  });

  it("refuse un commentaire vide, trop long ou une clé inconnue", () => {
    expect(rapportEtatFinancierCorpsSchema.safeParse({ commentaire: "" }).success).toBe(false);
    expect(
      rapportEtatFinancierCorpsSchema.safeParse({ commentaire: "a".repeat(4001) }).success,
    ).toBe(false);
    expect(rapportEtatFinancierCorpsSchema.safeParse({ autre: "x" }).success).toBe(false);
  });
});
