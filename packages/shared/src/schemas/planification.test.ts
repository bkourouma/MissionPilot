import { describe, expect, it } from "vitest";
import { aPermission, ROLES } from "../roles";
import {
  absenceDemandeSchema,
  affectationCreationSchema,
  affectationModificationSchema,
  affectationsListeQuerySchema,
  absencesListeQuerySchema,
  lienInterneSur,
  monPlanningQuerySchema,
  planDeChargeQuerySchema,
  replanificationSchema,
} from "./planification";

const UUID = "7f1c1c56-6a1a-4e6c-9b1e-2f3b4c5d6e7f";

describe("schémas de planification", () => {
  const base = {
    tache_id: UUID,
    jours_alloues: 2.5,
    date_debut: "2026-11-02",
    date_fin: "2026-11-06",
  };

  it("affectation : nominative OU profil à pourvoir, période cohérente, jours positifs", () => {
    expect(affectationCreationSchema.safeParse({ ...base, collaborateur_id: UUID }).success).toBe(
      true,
    );
    expect(
      affectationCreationSchema.safeParse({ ...base, profil: { grade_id: UUID, competence: "" } })
        .data?.profil,
    ).toEqual({ grade_id: UUID, competence: null });
    expect(affectationCreationSchema.safeParse(base).success).toBe(false);
    expect(
      affectationCreationSchema.safeParse({
        ...base,
        collaborateur_id: UUID,
        profil: { grade_id: UUID },
      }).success,
    ).toBe(false);
    expect(
      affectationCreationSchema.safeParse({ ...base, collaborateur_id: UUID, jours_alloues: 0 })
        .success,
    ).toBe(false);
    expect(
      affectationCreationSchema.safeParse({
        ...base,
        collaborateur_id: UUID,
        date_fin: "2026-11-01",
      }).success,
    ).toBe(false);
    expect(affectationModificationSchema.safeParse({}).success).toBe(false);
    expect(affectationModificationSchema.safeParse({ collaborateur_id: UUID }).success).toBe(false);
  });

  it("absence : type connu, période d'un an au plus", () => {
    const ok = { type: "conge_paye", date_debut: "2026-12-21", date_fin: "2027-01-02" };
    expect(absenceDemandeSchema.safeParse(ok).success).toBe(true);
    expect(absenceDemandeSchema.safeParse({ ...ok, type: "vacances" }).success).toBe(false);
    expect(absenceDemandeSchema.safeParse({ ...ok, date_fin: "2028-06-01" }).success).toBe(false);
  });

  it("plan de charge et re-planification : bornes", () => {
    expect(planDeChargeQuerySchema.safeParse({ limite: "101" }).success).toBe(false);
    expect(
      planDeChargeQuerySchema.safeParse({ debut: "2026-12-01", fin: "2026-11-01" }).success,
    ).toBe(false);
    expect(
      replanificationSchema.safeParse({ phase_id: UUID, decalage_jours_ouvres: 0 }).success,
    ).toBe(false);
    expect(
      replanificationSchema.safeParse({ phase_id: UUID, decalage_jours_ouvres: 1.5 }).success,
    ).toBe(false);
  });

  it("lien de notification : relatif et interne uniquement", () => {
    expect(lienInterneSur("/mon-planning?semaine=2026-11-02")).toBe(true);
    for (const lien of ["https://x.test", "//x.test", "/\\x.test", "javascript:alert(1)", "x"]) {
      expect(lienInterneSur(lien), lien).toBe(false);
    }
  });

  it("demander un congé : tous les rôles internes, pas l'expert externe", () => {
    const demandent = ROLES.filter((r) => aPermission([r], "conges.demander"));
    expect(demandent).not.toContain("expert_externe");
    expect(demandent).toHaveLength(ROLES.length - 1);
    expect(aPermission(["consultant"], "conges.valider")).toBe(false);
  });

  it("E1 : dates de planification bornées aux années 2000 à 2100, durées plafonnées", () => {
    const nominative = { ...base, collaborateur_id: UUID };
    const extremes = { date_debut: "0001-01-01", date_fin: "9999-12-31" };
    expect(affectationCreationSchema.safeParse({ ...nominative, ...extremes }).success).toBe(false);
    expect(affectationModificationSchema.safeParse(extremes).success).toBe(false);
    expect(affectationModificationSchema.safeParse({ date_fin: "2101-01-01" }).success).toBe(false);
    // 366 jours calendaires au plus (fin − début ≤ 365).
    expect(
      affectationCreationSchema.safeParse({
        ...nominative,
        date_debut: "2026-01-01",
        date_fin: "2027-01-01",
      }).success,
    ).toBe(true);
    expect(
      affectationCreationSchema.safeParse({
        ...nominative,
        date_debut: "2026-01-01",
        date_fin: "2027-01-02",
      }).success,
    ).toBe(false);
    expect(
      affectationModificationSchema.safeParse({ date_debut: "2026-01-01", date_fin: "2027-06-01" })
        .success,
    ).toBe(false);
    const absence = { type: "conge_paye", ...extremes };
    expect(absenceDemandeSchema.safeParse(absence).success).toBe(false);
    expect(
      absenceDemandeSchema.safeParse({
        ...absence,
        date_debut: "1999-12-31",
        date_fin: "2000-01-02",
      }).success,
    ).toBe(false);
    expect(absencesListeQuerySchema.safeParse({ debut: "0001-01-01" }).success).toBe(false);
    expect(monPlanningQuerySchema.safeParse({ semaine: "9999-12-31" }).success).toBe(false);
    expect(monPlanningQuerySchema.safeParse({ semaine: "2026-11-02" }).success).toBe(true);
  });

  it("M2 : plan de charge plafonné à 26 semaines dès le schéma", () => {
    expect(
      planDeChargeQuerySchema.safeParse({ debut: "0001-01-01", fin: "9999-12-31" }).success,
    ).toBe(false);
    // 26 semaines + 6 jours d'écart au plus.
    expect(
      planDeChargeQuerySchema.safeParse({ debut: "2026-11-04", fin: "2027-05-11" }).success,
    ).toBe(true);
    expect(
      planDeChargeQuerySchema.safeParse({ debut: "2026-11-04", fin: "2027-05-12" }).success,
    ).toBe(false);
  });

  it("F5 : liste des affectations paginée, 200 au plus par page", () => {
    expect(affectationsListeQuerySchema.parse({}).limite).toBe(100);
    expect(affectationsListeQuerySchema.safeParse({ limite: "201" }).success).toBe(false);
    expect(affectationsListeQuerySchema.safeParse({ inconnu: "1" }).success).toBe(false);
  });
});
