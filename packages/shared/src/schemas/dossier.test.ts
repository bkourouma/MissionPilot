import { describe, expect, it } from "vitest";
import {
  etatDecisionSchema,
  etatFinancierExcelQuerySchema,
  etatFinancierSaisieSchema,
  facteurValeurCreationSchema,
  faitCreationSchema,
  faitDecisionSchema,
  sourceDossierSchema,
  valeurFacteurConforme,
} from "./dossier";

const source = { type: "entretien", libelle: "Entretien avec le DAF" };

describe("schémas du dossier client", () => {
  it("fait : valeur typée, source, statut proposé par défaut", () => {
    const f = faitCreationSchema.parse({
      categorie: "finances",
      cle: "ca_estime",
      valeur: { type: "montant", montant: -5, devise: "XOF" },
      date_effet: "2026-01-01",
      source,
      fiabilite: "B",
    });
    expect(f.statut).toBe("propose");
    expect(() =>
      faitCreationSchema.parse({ ...f, valeur: { type: "montant", montant: 1.5, devise: "XOF" } }),
    ).toThrow();
    expect(() => faitCreationSchema.parse({ ...f, date_effet: "1899-12-31" })).toThrow();
    expect(() => faitCreationSchema.parse({ ...f, inconnu: 1 })).toThrow();
  });

  it("source : document et page réservés au type document", () => {
    expect(sourceDossierSchema.safeParse({ ...source, page: 2 }).success).toBe(false);
    expect(
      sourceDossierSchema.safeParse({ type: "document", libelle: "Liasse", page: 2 }).success,
    ).toBe(true);
  });

  it("décisions : motif obligatoire pour rejeter", () => {
    expect(faitDecisionSchema.safeParse({ decision: "rejete" }).success).toBe(false);
    expect(faitDecisionSchema.safeParse({ decision: "confirme" }).success).toBe(true);
    expect(etatDecisionSchema.safeParse({ decision: "rejete", motif: " " }).success).toBe(false);
    expect(etatDecisionSchema.safeParse({ decision: "accepte" }).success).toBe(true);
  });

  it("facteur : valeur conforme au type ; valeurs de convention imposées ; prototype ignoré", () => {
    const base = { date_effet: "2026-01-01", source, fiabilite: "A" };
    const ok = (corps: Record<string, unknown>) =>
      facteurValeurCreationSchema.safeParse({ ...base, ...corps }).success;
    expect(ok({ code: "fiabilite_comptes", type: "enumeration", valeur: "certifies" })).toBe(true);
    expect(ok({ code: "fiabilite_comptes", type: "enumeration", valeur: "autre" })).toBe(false);
    expect(ok({ code: "part_informel", type: "liste", valeur: ["forte"] })).toBe(false);
    expect(ok({ code: "constructor", type: "booleen", valeur: true })).toBe(true);
    expect(ok({ code: "effectif", type: "nombre", valeur: "42" })).toBe(false);
    expect(valeurFacteurConforme("liste", ["a", "a"])).toBe(false);
    expect(valeurFacteurConforme("liste", ["a", "b"])).toBe(true);
    expect(valeurFacteurConforme("nombre", 3)).toBe(true);
  });

  it("état financier : bornes des lignes, requête d'import Excel", () => {
    const ligne = { code: "AZ", libelle: "Actif", section: "actif", montant: 1 };
    const etat = { exercice: 2025, date_cloture: "2025-12-31", devise: "XOF", lignes: [ligne] };
    expect(etatFinancierSaisieSchema.parse(etat).tolerance).toBe(0);
    expect(etatFinancierSaisieSchema.safeParse({ ...etat, lignes: [] }).success).toBe(false);
    expect(
      etatFinancierSaisieSchema.safeParse({ ...etat, lignes: [{ ...ligne, code: "A Z" }] }).success,
    ).toBe(false);
    expect(
      etatFinancierExcelQuerySchema.parse({
        exercice: "2025",
        date_cloture: "2025-12-31",
        devise: "XOF",
      }),
    ).toEqual({ exercice: 2025, date_cloture: "2025-12-31", devise: "XOF", tolerance: 0 });
    expect(
      etatFinancierExcelQuerySchema.safeParse({
        exercice: "25",
        date_cloture: "2025-12-31",
        devise: "XOF",
      }).success,
    ).toBe(false);
  });
});
