import { describe, expect, it } from "vitest";
import {
  kpiActionCreationSchema,
  kpiActionStatutSchema,
  kpiArbreContributionsQuerySchema,
  kpiArbreCreationSchema,
  kpiDecisionStatutSchema,
  kpiNoeudCreationSchema,
  kpiNoeudModificationSchema,
  kpiRevueCreationSchema,
  kpiRevueDossierQuerySchema,
  kpiRevueModificationSchema,
  kpiRevueOrdreDuJourSchema,
} from "./kpi-pilotage";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("arbres d'indicateurs", () => {
  it("création stricte : champ inconnu refusé", () => {
    expect(kpiArbreCreationSchema.safeParse({ kpi_racine_id: UUID, libelle: "CA" }).success).toBe(
      true,
    );
    expect(
      kpiArbreCreationSchema.safeParse({ kpi_racine_id: UUID, libelle: "CA", extra: 1 }).success,
    ).toBe(false);
    expect(kpiArbreCreationSchema.safeParse({ kpi_racine_id: "x", libelle: "CA" }).success).toBe(
      false,
    );
  });

  it("nœud : valeurs par défaut et coefficient borné à 4 décimales", () => {
    const n = kpiNoeudCreationSchema.parse({ parent_id: UUID, libelle: "Volume" });
    expect(n).toMatchObject({ relation: "somme", coefficient: 1, rang: 0 });
    expect(
      kpiNoeudCreationSchema.safeParse({ parent_id: UUID, libelle: "x", coefficient: -1.5 })
        .success,
    ).toBe(true);
    for (const coefficient of [1.23456, 10000, Number.NaN]) {
      expect(
        kpiNoeudCreationSchema.safeParse({ parent_id: UUID, libelle: "x", coefficient }).success,
      ).toBe(false);
    }
    expect(
      kpiNoeudCreationSchema.safeParse({ parent_id: UUID, libelle: "x", rang: 1000 }).success,
    ).toBe(false);
    expect(kpiNoeudModificationSchema.safeParse({}).success).toBe(false);
    expect(kpiNoeudModificationSchema.safeParse({ actif: false }).success).toBe(true);
  });

  it("deux situations comparées : dates valides et bornées", () => {
    expect(kpiArbreContributionsQuerySchema.safeParse({ avant: "2026-03-15" }).success).toBe(true);
    expect(kpiArbreContributionsQuerySchema.safeParse({ avant: "2026-02-30" }).success).toBe(false);
    expect(kpiArbreContributionsQuerySchema.safeParse({ avant: "1999-12-31" }).success).toBe(false);
    expect(kpiArbreContributionsQuerySchema.safeParse({ avant: "2999-01-01" }).success).toBe(false);
    expect(kpiArbreContributionsQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("actions correctives", () => {
  it("création : responsable et échéance obligatoires", () => {
    const base = { kpi_id: UUID, titre: "Relancer", responsable_id: UUID, echeance: "2026-06-30" };
    expect(kpiActionCreationSchema.safeParse(base).success).toBe(true);
    expect(kpiActionCreationSchema.safeParse({ ...base, alerte_id: UUID }).success).toBe(true);
    expect(kpiActionCreationSchema.safeParse({ ...base, responsable_id: undefined }).success).toBe(
      false,
    );
    expect(kpiActionCreationSchema.safeParse({ ...base, echeance: "bientôt" }).success).toBe(false);
  });

  it("statut : motif pour l'abandon seulement, date d'effet pour la clôture seulement", () => {
    expect(kpiActionStatutSchema.safeParse({ statut: "en_cours" }).success).toBe(true);
    expect(kpiActionStatutSchema.safeParse({ statut: "abandonnee" }).success).toBe(false);
    expect(
      kpiActionStatutSchema.safeParse({ statut: "abandonnee", motif: "Remplacée" }).success,
    ).toBe(true);
    expect(kpiActionStatutSchema.safeParse({ statut: "en_cours", motif: "x" }).success).toBe(false);
    expect(
      kpiActionStatutSchema.safeParse({ statut: "terminee", date_effet: "2026-03-01" }).success,
    ).toBe(true);
    expect(
      kpiActionStatutSchema.safeParse({
        statut: "abandonnee",
        motif: "x",
        date_effet: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(kpiActionStatutSchema.safeParse({ statut: "a_faire" }).success).toBe(false);
  });
});

describe("revues de performance", () => {
  it("création, modification non vide, dossier au format connu", () => {
    expect(
      kpiRevueCreationSchema.safeParse({ titre: "Revue de mai", date_prevue: "2026-05-20" })
        .success,
    ).toBe(true);
    expect(kpiRevueCreationSchema.safeParse({ titre: "", date_prevue: "2026-05-20" }).success).toBe(
      false,
    );
    expect(kpiRevueModificationSchema.safeParse({}).success).toBe(false);
    expect(kpiRevueModificationSchema.safeParse({ compte_rendu: "Notes" }).success).toBe(true);
    expect(kpiRevueDossierQuerySchema.safeParse({ format: "pptx" }).success).toBe(true);
    expect(kpiRevueDossierQuerySchema.safeParse({ format: "xlsx" }).success).toBe(false);
  });

  it("ordre du jour saisi : durées entières, 40 points au plus", () => {
    expect(
      kpiRevueOrdreDuJourSchema.safeParse({
        points: [{ libelle: "Tour de table", duree_minutes: 10 }],
      }).success,
    ).toBe(true);
    expect(
      kpiRevueOrdreDuJourSchema.safeParse({ points: [{ libelle: "x", duree_minutes: 0 }] }).success,
    ).toBe(false);
    expect(
      kpiRevueOrdreDuJourSchema.safeParse({ points: [{ libelle: "x", duree_minutes: 1.5 }] })
        .success,
    ).toBe(false);
    const quarante = Array.from({ length: 41 }, () => ({ libelle: "x", duree_minutes: 5 }));
    expect(kpiRevueOrdreDuJourSchema.safeParse({ points: quarante }).success).toBe(false);
  });

  it("décision : motif pour l'abandon, commentaire pour l'exécution", () => {
    expect(kpiDecisionStatutSchema.safeParse({ statut: "executee" }).success).toBe(false);
    expect(
      kpiDecisionStatutSchema.safeParse({ statut: "executee", commentaire: "  " }).success,
    ).toBe(false);
    expect(
      kpiDecisionStatutSchema.safeParse({ statut: "executee", commentaire: "Relances faites" })
        .success,
    ).toBe(true);
    expect(kpiDecisionStatutSchema.safeParse({ statut: "en_cours" }).success).toBe(true);
    expect(kpiDecisionStatutSchema.safeParse({ statut: "abandonnee" }).success).toBe(false);
    expect(
      kpiDecisionStatutSchema.safeParse({ statut: "abandonnee", motif: "Hors périmètre" }).success,
    ).toBe(true);
    expect(kpiDecisionStatutSchema.safeParse({ statut: "executee", motif: "x" }).success).toBe(
      false,
    );
  });
});
