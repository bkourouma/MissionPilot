import { describe, expect, it } from "vitest";
import { aPermission, ROLES } from "../roles";
import {
  correctionDemandeSchema,
  feuilleRejetSchema,
  feuilleValidationSchema,
  importTempsQuerySchema,
  ligneTempsSaisieSchema,
  moisSchema,
  tempsParametresSchema,
} from "./temps";

const ID = "00000000-0000-4000-8000-000000000001";

describe("schémas des temps", () => {
  it("une ligne : tâche OU activité, jours OU heures", () => {
    expect(
      ligneTempsSaisieSchema.safeParse({ date: "2026-11-02", tache_id: ID, jours: 1 }).success,
    ).toBe(true);
    expect(
      ligneTempsSaisieSchema.safeParse({ date: "2026-11-02", activite_id: ID, heures: 2.5 })
        .success,
    ).toBe(true);
    expect(
      ligneTempsSaisieSchema.safeParse({
        date: "2026-11-02",
        tache_id: ID,
        activite_id: ID,
        jours: 1,
      }).success,
    ).toBe(false);
    expect(
      ligneTempsSaisieSchema.safeParse({ date: "2026-11-02", tache_id: ID, jours: 1, heures: 8 })
        .success,
    ).toBe(false);
    expect(
      ligneTempsSaisieSchema.safeParse({ date: "2026-11-02", tache_id: ID, jours: 0 }).success,
    ).toBe(false);
    expect(
      ligneTempsSaisieSchema.safeParse({ date: "2026-11-02", tache_id: ID, heures: 25 }).success,
    ).toBe(false);
  });

  it("rejet : motif obligatoire ; une seule partie", () => {
    expect(feuilleRejetSchema.safeParse({}).success).toBe(false);
    expect(feuilleRejetSchema.safeParse({ motif: "Préciser" }).success).toBe(true);
    expect(feuilleValidationSchema.safeParse({ mission_id: ID, interne: true }).success).toBe(
      false,
    );
  });

  it("mois, paramètres, corrections, import", () => {
    expect(moisSchema.safeParse("2025-03").success).toBe(true);
    expect(moisSchema.safeParse("2025-13").success).toBe(false);
    expect(tempsParametresSchema.safeParse({ seuil_consommation_pct: 101 }).success).toBe(false);
    expect(
      correctionDemandeSchema.safeParse({
        collaborateur_id: ID,
        date: "2025-03-03",
        tache_id: ID,
        jours: 0,
        motif: "x",
      }).success,
    ).toBe(true);
    expect(importTempsQuerySchema.parse({}).simulation).toBe("true");
  });

  it("import des temps : associé et gestionnaire seulement", () => {
    expect(ROLES.filter((r) => aPermission([r], "temps.importer")).sort()).toEqual([
      "associe",
      "gestionnaire",
    ]);
  });
});
