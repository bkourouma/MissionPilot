import { describe, expect, it } from "vitest";
import { chargeActiviteDemoSchema } from "./activite-demo";

describe("charge de la tâche activite_demo", () => {
  it("accepte la tâche mensuelle et la tâche de suite", () => {
    expect(chargeActiviteDemoSchema.parse({ mois: "2026-11" })).toEqual({ mois: "2026-11" });
    expect(chargeActiviteDemoSchema.parse({ mois: "2026-11", semaine: "2026-11-02" })).toEqual({
      mois: "2026-11",
      semaine: "2026-11-02",
    });
  });

  it("schéma strict : un champ en trop est refusé", () => {
    for (const enTrop of [
      { mois: "2026-11", cabinet_id: "x" },
      { mois: "2026-11", semaine: "2026-11-02", lot: 1 },
    ]) {
      expect(chargeActiviteDemoSchema.safeParse(enTrop).success).toBe(false);
    }
  });

  it("refuse un mois invalide ou absent", () => {
    for (const mois of ["2026-13", "2026-00", "2026-1", "novembre", "", undefined, 202611]) {
      expect(chargeActiviteDemoSchema.safeParse({ mois }).success, String(mois)).toBe(false);
    }
  });

  it("refuse une date invalide ou hors des bornes des colonnes de dates", () => {
    for (const semaine of ["2026-02-30", "2026-11-2", "lundi", "1999-12-27", "2101-01-03", null]) {
      const r = chargeActiviteDemoSchema.safeParse({ mois: "2026-11", semaine });
      expect(r.success, String(semaine)).toBe(false);
    }
  });
});
