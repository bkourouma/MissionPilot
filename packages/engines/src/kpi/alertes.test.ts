import { describe, expect, it } from "vitest";
import {
  DELAI_GRACE_KPI_DEFAUT_JOURS,
  PERIODES_DEGRADATION_KPI_DEFAUT,
  alerteDegradationKpi,
  alerteRetardKpi,
  alertesSeuilsKpi,
  degradationsConsecutivesKpi,
} from "./alertes";
import { ErreurKpi } from "./erreurs";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

describe("dégradation sur N périodes consécutives", () => {
  it.each<[(number | null)[], "plus_haut_mieux" | "plus_bas_mieux", number]>([
    [[100, 95, 90, 85], "plus_haut_mieux", 3],
    [[100, 95, 96, 90], "plus_haut_mieux", 1],
    [[100, 105, 110, 115], "plus_bas_mieux", 3],
    [[100, 105, 110, 115], "plus_haut_mieux", 0],
    [[100, null, 90, 80], "plus_haut_mieux", 1],
    [[100, 90, null], "plus_haut_mieux", 0],
    [[100, 100, 90], "plus_haut_mieux", 1],
    [[], "plus_haut_mieux", 0],
    [[5], "plus_haut_mieux", 0],
  ])("%j en %s → %d", (serie, sens, attendu) => {
    expect(degradationsConsecutivesKpi(serie, sens)).toBe(attendu);
  });

  it("tolérance relative : une petite baisse ne compte pas", () => {
    expect(degradationsConsecutivesKpi([100, 96, 91], "plus_haut_mieux")).toBe(2);
    expect(
      degradationsConsecutivesKpi([100, 96, 91], "plus_haut_mieux", { toleranceRelative: 0.05 }),
    ).toBe(1);
    // Baisse de 5 exactement sur 100 avec 5 % de tolérance : pas une dégradation.
    expect(
      degradationsConsecutivesKpi([100, 95], "plus_haut_mieux", { toleranceRelative: 0.05 }),
    ).toBe(0);
  });

  it("alerte à partir de N, 3 par défaut", () => {
    expect(PERIODES_DEGRADATION_KPI_DEFAUT).toBe(3);
    expect(alerteDegradationKpi([100, 95, 90, 85], "plus_haut_mieux")).toEqual({
      code: "DEGRADATION_CONSECUTIVE",
      periodes: 3,
      seuil: 3,
    });
    expect(alerteDegradationKpi([100, 95, 90], "plus_haut_mieux")).toBeNull();
    expect(alerteDegradationKpi([100, 95, 90], "plus_haut_mieux", { periodes: 2 })).toMatchObject({
      periodes: 2,
    });
    expect(codeErreur(() => alerteDegradationKpi([1], "plus_haut_mieux", { periodes: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });
});

describe("mesure en retard sur sa fréquence", () => {
  const mensuel = { frequence: "mensuelle", datesMesures: ["2026-01-15", "2026-02-10"] } as const;

  it("délai de grâce de 5 jours par défaut, échéance incluse", () => {
    expect(DELAI_GRACE_KPI_DEFAUT_JOURS).toBe(5);
    expect(alerteRetardKpi({ ...mensuel, dateReference: "2026-04-05" })).toBeNull();
    expect(alerteRetardKpi({ ...mensuel, dateReference: "2026-04-06" })).toEqual({
      code: "MESURE_EN_RETARD",
      periodeAttendue: "2026-03",
      echeance: "2026-04-05",
      joursDeRetard: 1,
      periodesManquantes: 1,
      dernierePeriodeDue: "2026-03",
    });
  });

  it("délai nul : en retard dès le lendemain de la fin de période", () => {
    expect(
      alerteRetardKpi({ ...mensuel, dateReference: "2026-03-31", delaiGraceJours: 0 }),
    ).toBeNull();
    expect(
      alerteRetardKpi({ ...mensuel, dateReference: "2026-04-01", delaiGraceJours: 0 }),
    ).toMatchObject({ periodeAttendue: "2026-03", joursDeRetard: 1 });
  });

  it("long délai : la période due recule d'autant", () => {
    expect(
      alerteRetardKpi({ ...mensuel, dateReference: "2026-04-06", delaiGraceJours: 40 }),
    ).toBeNull();
  });

  it("indépendant de l'ordre des mesures ; une mesure antérieure au suivi ne compte pas", () => {
    const attendu = alerteRetardKpi({ ...mensuel, dateReference: "2026-04-06" });
    expect(
      alerteRetardKpi({
        frequence: "mensuelle",
        datesMesures: ["2026-02-10", "2026-01-15"],
        dateReference: "2026-04-06",
      }),
    ).toEqual(attendu);
    expect(
      alerteRetardKpi({
        frequence: "mensuelle",
        datesMesures: ["2025-11-15"],
        suiviDepuis: "2026-02-01",
        dateReference: "2026-04-06",
      }),
    ).toMatchObject({ periodeAttendue: "2026-02", periodesManquantes: 2 });
  });

  it("suivi sans aucune mesure : toutes les périodes dues manquent", () => {
    expect(
      alerteRetardKpi({
        frequence: "mensuelle",
        datesMesures: [],
        suiviDepuis: "2026-01-01",
        dateReference: "2026-04-06",
      }),
    ).toEqual({
      code: "MESURE_EN_RETARD",
      periodeAttendue: "2026-01",
      echeance: "2026-02-05",
      joursDeRetard: 60,
      periodesManquantes: 3,
      dernierePeriodeDue: "2026-03",
    });
  });

  it("pas d'alerte sans suivi ni mesure, ni avant le début du suivi, ni à jour", () => {
    const base = { frequence: "mensuelle", dateReference: "2026-04-06" } as const;
    expect(alerteRetardKpi({ ...base, datesMesures: [] })).toBeNull();
    expect(alerteRetardKpi({ ...base, datesMesures: [], suiviDepuis: "2026-05-01" })).toBeNull();
    expect(alerteRetardKpi({ ...base, datesMesures: ["2026-03-28"] })).toBeNull();
    expect(alerteRetardKpi({ ...base, datesMesures: ["2026-04-02"] })).toBeNull();
  });

  it("trimestriel : retard compté depuis la plus ancienne période manquante", () => {
    expect(
      alerteRetardKpi({
        frequence: "trimestrielle",
        datesMesures: ["2026-02-01"],
        dateReference: "2026-10-06",
      }),
    ).toEqual({
      code: "MESURE_EN_RETARD",
      periodeAttendue: "2026-T2",
      echeance: "2026-07-05",
      joursDeRetard: 93,
      periodesManquantes: 2,
      dernierePeriodeDue: "2026-T3",
    });
  });

  it("hebdomadaire", () => {
    expect(
      alerteRetardKpi({
        frequence: "hebdomadaire",
        datesMesures: ["2026-09-23"],
        dateReference: "2026-10-06",
        delaiGraceJours: 1,
      }),
    ).toMatchObject({
      periodeAttendue: "2026-W40",
      echeance: "2026-10-05",
      joursDeRetard: 1,
      periodesManquantes: 1,
    });
  });

  it("refuse un délai de grâce invalide ou une date invalide", () => {
    for (const delaiGraceJours of [-1, 1.5, 4000]) {
      expect(
        codeErreur(() =>
          alerteRetardKpi({ ...mensuel, dateReference: "2026-04-06", delaiGraceJours }),
        ),
      ).toBe("OPTIONS_INVALIDES");
    }
    expect(codeErreur(() => alerteRetardKpi({ ...mensuel, dateReference: "2026-04-31" }))).toBe(
      "DATE_INVALIDE",
    );
  });
});

describe("alertes de seuil (KPI-04)", () => {
  it("seuil haut et bas stricts", () => {
    expect(alertesSeuilsKpi(120, null, { haut: 100 })).toEqual([
      { code: "SEUIL_HAUT", valeur: 120, seuil: 100 },
    ]);
    expect(alertesSeuilsKpi(100, null, { haut: 100 })).toEqual([]);
    expect(alertesSeuilsKpi(49.99, null, { bas: 50 })).toEqual([
      { code: "SEUIL_BAS", valeur: 49.99, seuil: 50 },
    ]);
    expect(alertesSeuilsKpi(50, null, { bas: 50, haut: 50 })).toEqual([]);
  });

  it("variation relative stricte depuis la période précédente", () => {
    const seuils = { variationMax: 0.2 };
    expect(alertesSeuilsKpi(120, 100, seuils)).toEqual([]);
    expect(alertesSeuilsKpi(80, 100, seuils)).toEqual([]);
    expect(alertesSeuilsKpi(120.01, 100, seuils)).toEqual([
      { code: "VARIATION", valeur: 120.01, precedente: 100, variationRelative: 0.2001, seuil: 0.2 },
    ]);
    expect(alertesSeuilsKpi(79.99, 100, seuils)[0]).toMatchObject({ variationRelative: -0.2001 });
    expect(alertesSeuilsKpi(-130, -100, seuils)[0]).toMatchObject({ variationRelative: -0.3 });
    expect(alertesSeuilsKpi(120.01, null, seuils)).toEqual([]);
  });

  it("depuis une valeur précédente nulle", () => {
    expect(alertesSeuilsKpi(5, 0, { variationMax: 0.5 })).toEqual([
      { code: "VARIATION", valeur: 5, precedente: 0, variationRelative: null, seuil: 0.5 },
    ]);
    expect(alertesSeuilsKpi(0, 0, { variationMax: 0.5 })).toEqual([]);
  });

  it("cumule les alertes, aucune sans valeur", () => {
    expect(
      alertesSeuilsKpi(200, 100, { haut: 150, bas: 10, variationMax: 0.5 }).map((a) => a.code),
    ).toEqual(["SEUIL_HAUT", "VARIATION"]);
    expect(alertesSeuilsKpi(null, 100, { haut: 1, variationMax: 0 })).toEqual([]);
    expect(alertesSeuilsKpi(5, 5, {})).toEqual([]);
  });

  it("refuse des seuils incohérents", () => {
    expect(codeErreur(() => alertesSeuilsKpi(null, null, { haut: 10, bas: 20 }))).toBe(
      "SEUILS_INVALIDES",
    );
    expect(codeErreur(() => alertesSeuilsKpi(1, 1, { variationMax: -0.1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });
});
