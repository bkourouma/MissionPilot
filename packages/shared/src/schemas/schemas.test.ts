import { describe, expect, it } from "vitest";
import {
  cabinetModificationSchema,
  clientCreationSchema,
  collaborateurCoutsSchema,
  dateIsoSchema,
  invitationAcceptationSchema,
  joursParGradeSchema,
  utilisateurModificationSchema,
} from "../index";

describe("schémas partagés", () => {
  it("dates calendaires strictes", () => {
    expect(dateIsoSchema.safeParse("2026-08-07").success).toBe(true);
    expect(dateIsoSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateIsoSchema.safeParse("07/08/2026").success).toBe(false);
  });

  it("mot de passe d'invitation : 12 caractères au moins", () => {
    const base = { jeton: "x".repeat(43), nom: "A" };
    expect(invitationAcceptationSchema.safeParse({ ...base, mot_de_passe: "court" }).success).toBe(
      false,
    );
    expect(
      invitationAcceptationSchema.safeParse({ ...base, mot_de_passe: "assez-long-12" }).success,
    ).toBe(true);
  });

  it("corps de modification : vide ou champ inconnu refusés", () => {
    expect(utilisateurModificationSchema.safeParse({}).success).toBe(false);
    expect(utilisateurModificationSchema.safeParse({ cabinet_id: "x" }).success).toBe(false);
    expect(cabinetModificationSchema.safeParse({ jours_travailles: [5, 1, 1] }).data).toEqual({
      jours_travailles: [1, 5],
    });
  });

  it("client : chaînes vides → null, pays par défaut CI", () => {
    const r = clientCreationSchema.parse({ raison_sociale: " ACME ", rccm: "  " });
    expect(r).toMatchObject({ raison_sociale: "ACME", rccm: null, pays: "CI", actif: true });
  });

  it("montants entiers positifs, au moins un montant pour une ligne de coûts", () => {
    const base = { devise: "XOF", depuis_le: "2026-01-01" };
    expect(collaborateurCoutsSchema.safeParse({ ...base, cout_journalier: 1.5 }).success).toBe(
      false,
    );
    expect(collaborateurCoutsSchema.safeParse(base).success).toBe(false);
    expect(collaborateurCoutsSchema.safeParse({ ...base, cout_achat: 200000 }).success).toBe(true);
  });

  it("jours par grade au pas de la demi-journée", () => {
    expect(joursParGradeSchema.safeParse({ senior: 2.5 }).success).toBe(true);
    expect(joursParGradeSchema.safeParse({ senior: 2.3 }).success).toBe(false);
    expect(joursParGradeSchema.safeParse({ Senior: 1 }).success).toBe(false);
  });
});
