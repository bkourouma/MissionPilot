import { describe, expect, it } from "vitest";
import {
  dependanceCreationSchema,
  documentCreationSchema,
  ligneBudgetSaisieSchema,
  missionCreationSchema,
  missionSignatureSchema,
  opportuniteIssueSchema,
  reorganisationSchema,
  revisionCreationSchema,
  tacheBudgetSchema,
} from "../index";

const UUID = "00000000-0000-4000-8000-000000000001";
const UUID2 = "00000000-0000-4000-8000-000000000002";

describe("schémas du cycle commercial et des missions", () => {
  it("opportunité perdue : motif obligatoire", () => {
    expect(opportuniteIssueSchema.safeParse({ statut: "perdue" }).success).toBe(false);
    expect(opportuniteIssueSchema.safeParse({ statut: "perdue", motif_perte: " " }).success).toBe(
      false,
    );
    expect(
      opportuniteIssueSchema.safeParse({ statut: "perdue", motif_perte: "Prix" }).success,
    ).toBe(true);
    expect(opportuniteIssueSchema.safeParse({ statut: "gagnee", motif_perte: "x" }).success).toBe(
      false,
    );
  });

  it("mission : défauts, dates cohérentes, statut initial limité", () => {
    const base = { intitule: "M", client_id: UUID };
    expect(missionCreationSchema.parse(base)).toMatchObject({
      devise: "XOF",
      statut: "proposition",
      type_mission_id: null,
    });
    expect(
      missionCreationSchema.safeParse({ ...base, date_debut: "2026-12-01", date_fin: "2026-11-01" })
        .success,
    ).toBe(false);
    expect(missionCreationSchema.safeParse({ ...base, statut: "signee" }).success).toBe(false);
  });

  it("signature : taux de change positif, lignes supplémentaires débours ou sous-traitance", () => {
    const base = { date_signature: "2026-10-01" };
    expect(missionSignatureSchema.safeParse({ ...base, taux_change: 0 }).success).toBe(false);
    expect(
      missionSignatureSchema.safeParse({
        ...base,
        lignes_supplementaires: [{ nature: "honoraires", libelle: "X", montant: 1 }],
      }).success,
    ).toBe(false);
    expect(
      missionSignatureSchema.safeParse({
        ...base,
        lignes_supplementaires: [
          { nature: "sous_traitance", libelle: "X", montant: 1, refacturable: true },
        ],
      }).success,
    ).toBe(false);
  });

  it("budget de tâche : grade ou personne, jours au centième, sans doublon", () => {
    expect(tacheBudgetSchema.safeParse({ lignes: [{ grade_id: UUID, jours: 0.25 }] }).success).toBe(
      true,
    );
    expect(
      tacheBudgetSchema.safeParse({ lignes: [{ grade_id: UUID, jours: 0.255 }] }).success,
    ).toBe(false);
    expect(tacheBudgetSchema.safeParse({ lignes: [{ jours: 1 }] }).success).toBe(false);
    expect(
      tacheBudgetSchema.safeParse({
        lignes: [
          { collaborateur_id: UUID, jours: 1 },
          { collaborateur_id: UUID, jours: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it("ligne de budget : au temps ou au forfait, pas les deux", () => {
    const base = { libelle: "L", nature: "honoraires" };
    expect(ligneBudgetSaisieSchema.safeParse({ ...base, montant_forfait: 1 }).success).toBe(true);
    expect(
      ligneBudgetSaisieSchema.safeParse({ ...base, jours: 1, prix_journalier: 1 }).success,
    ).toBe(true);
    expect(ligneBudgetSaisieSchema.safeParse({ ...base, jours: 1 }).success).toBe(false);
    expect(
      ligneBudgetSaisieSchema.safeParse({
        ...base,
        jours: 1,
        prix_journalier: 1,
        montant_forfait: 1,
      }).success,
    ).toBe(false);
  });

  it("révision : motif obligatoire ; lignes ou recalcul, pas les deux", () => {
    expect(revisionCreationSchema.safeParse({}).success).toBe(false);
    expect(
      revisionCreationSchema.safeParse({ motif: "M", depuis_decoupage: true, lignes: [] }).success,
    ).toBe(false);
  });

  it("dépendance et réorganisation", () => {
    expect(
      dependanceCreationSchema.safeParse({ predecesseur_id: UUID, successeur_id: UUID }).success,
    ).toBe(false);
    expect(
      dependanceCreationSchema.parse({ predecesseur_id: UUID, successeur_id: UUID2 }).decalage,
    ).toBe(0);
    expect(reorganisationSchema.safeParse({ deplacements: [] }).success).toBe(false);
  });

  it("document : chemin de stockage relatif seulement (F1)", () => {
    const doc = (chemin_stockage: unknown) =>
      documentCreationSchema.safeParse({ type: "livrable", nom: "R", chemin_stockage }).success;
    expect(doc("missions/rapport-v2.pdf")).toBe(true);
    expect(doc(null)).toBe(true);
    expect(doc(undefined)).toBe(true);
    for (const pirate of [
      "../../etc/passwd",
      "missions/../secret.pdf",
      "missions\\rapport.pdf",
      "/etc/passwd",
      "file:///etc/passwd",
      "https://exemple.test/x.pdf",
      "C:/Windows/win.ini",
      "missions/a\u0000b.pdf",
    ]) {
      expect(doc(pirate), pirate).toBe(false);
    }
  });
});
