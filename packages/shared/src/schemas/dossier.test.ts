import { describe, expect, it } from "vitest";
import {
  etatDecisionSchema,
  etatFinancierExcelQuerySchema,
  etatFinancierSaisieSchema,
  ligneEtatFinancierSchema,
  facteurValeurCreationSchema,
  faitCreationSchema,
  faitDecisionSchema,
  groupeQuerySchema,
  INDICATEURS_GROUPE,
  INDICATEUR_GROUPE_LIBELLES,
  MOTIFS_EXCLUSION_GROUPE,
  MOTIF_DETENTION_MAX,
  MOTIF_EXCLUSION_GROUPE_LIBELLES,
  PARTICIPATIONS_PAR_CABINET_MAX,
  participationCreationSchema,
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

  it("référence d'une ligne d'état lue par OCR : ocr vrai seulement, confiance de 0 à 1000", () => {
    const ligne = { code: "AZ", libelle: "Actif", section: "actif", montant: 1 };
    const avec = (reference: unknown) =>
      ligneEtatFinancierSchema.safeParse({ ...ligne, reference });
    const ok = avec({ fichier: "scan.pdf", page: 2, ocr: true, confiance_pm: 910 });
    expect(ok.success && ok.data.reference).toEqual({
      fichier: "scan.pdf",
      page: 2,
      ocr: true,
      confiance_pm: 910,
    });
    expect(avec({ fichier: "a.pdf", page: 1 }).success).toBe(true);
    expect(avec({ page: 1, ocr: true, confiance_pm: null }).success).toBe(true);
    expect(avec({ page: 1, confiance_pm: 0 }).success).toBe(true);
    expect(avec({ page: 1, confiance_pm: 1000 }).success).toBe(true);
    expect(avec({ page: 1, ocr: false }).success).toBe(false);
    expect(avec({ page: 1, ocr: "oui" }).success).toBe(false);
    expect(avec({ page: 1, confiance_pm: 1001 }).success).toBe(false);
    expect(avec({ page: 1, confiance_pm: -1 }).success).toBe(false);
    expect(avec({ page: 1, confiance_pm: 9.5 }).success).toBe(false);
    expect(avec({ page: 1, texte: "x" }).success).toBe(false);
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

describe("schémas des groupes et filiales (DOS-05)", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const base = { detenteur_id: a, filiale_id: b, points_base: 6000, date_effet: "2026-01-01" };

  it("participation valide, bornes 0 et 10 000", () => {
    expect(participationCreationSchema.parse(base).points_base).toBe(6000);
    expect(participationCreationSchema.safeParse({ ...base, points_base: 10_000 }).success).toBe(
      true,
    );
    expect(participationCreationSchema.safeParse({ ...base, points_base: 10_001 }).success).toBe(
      false,
    );
    expect(participationCreationSchema.safeParse({ ...base, points_base: -1 }).success).toBe(false);
    expect(participationCreationSchema.safeParse({ ...base, points_base: 50.5 }).success).toBe(
      false,
    );
  });

  it("motif obligatoire pour une fin de détention, borné à 500", () => {
    expect(participationCreationSchema.safeParse({ ...base, points_base: 0 }).success).toBe(false);
    expect(
      participationCreationSchema.safeParse({ ...base, points_base: 0, motif: "Cession" }).success,
    ).toBe(true);
    expect(participationCreationSchema.safeParse({ ...base, motif: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(participationCreationSchema.safeParse({ ...base, motif: "x".repeat(500) }).success).toBe(
      true,
    );
  });

  it("refuse l'auto-détention, les champs inconnus et les dates hors bornes", () => {
    expect(participationCreationSchema.safeParse({ ...base, filiale_id: a }).success).toBe(false);
    expect(participationCreationSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      participationCreationSchema.safeParse({ ...base, date_effet: "1999-12-31" }).success,
    ).toBe(false);
    expect(participationCreationSchema.safeParse({ ...base, detenteur_id: "x" }).success).toBe(
      false,
    );
  });

  it("requête de groupe : défauts, coercition et bornes", () => {
    expect(groupeQuerySchema.parse({}).vue).toBe("tete");
    expect(
      groupeQuerySchema.parse({ exercice: "2025", vue: "client", date: "2026-03-01" }),
    ).toEqual({
      exercice: 2025,
      vue: "client",
      date: "2026-03-01",
    });
    expect(groupeQuerySchema.safeParse({ exercice: 1989 }).success).toBe(false);
    expect(groupeQuerySchema.safeParse({ exercice: 2101 }).success).toBe(false);
    expect(groupeQuerySchema.safeParse({ vue: "autre" }).success).toBe(false);
    expect(groupeQuerySchema.safeParse({ inconnu: 1 }).success).toBe(false);
  });

  it("libellés français complets", () => {
    for (const c of INDICATEURS_GROUPE) expect(INDICATEUR_GROUPE_LIBELLES[c]).toBeTruthy();
    for (const m of MOTIFS_EXCLUSION_GROUPE) {
      expect(MOTIF_EXCLUSION_GROUPE_LIBELLES[m]).toBeTruthy();
    }
    expect(MOTIF_EXCLUSION_GROUPE_LIBELLES.NON_VISIBLE).toBe("Dossier non visible avec vos droits");
    expect(PARTICIPATIONS_PAR_CABINET_MAX).toBe(5000);
    expect(MOTIF_DETENTION_MAX).toBe(500);
  });
});
