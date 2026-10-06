import { describe, expect, it } from "vitest";
import {
  HORIZON_ARRETE_KPI_JOURS,
  kpiCibleSchema,
  kpiMesureSchema,
  kpiTableauQuerySchema,
  valeurKpiSchema,
} from "./kpi";

/*
 * Valeurs des KPI : jamais d'arrondi silencieux. Un nombre JSON est un double
 * IEEE 754 : au-delà de 15 chiffres significatifs il n'est plus celui saisi,
 * il est refusé. Date d'arrêté bornée (nombre de périodes évaluées).
 */

const jour = (decalage: number) =>
  new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);

describe("valeur d'un KPI (non-régression : arrondi silencieux)", () => {
  it("refuse un nombre qui a perdu des chiffres en devenant un double", () => {
    // JSON.parse de « 123456789012345.123456 » : 123456789012345.12, déjà arrondi.
    const recu = (texte: string) => JSON.parse(texte) as number;
    expect(String(recu("123456789012345.123456"))).toBe("123456789012345.12");
    for (const texte of ["123456789012345.123456", "999999999999999.9", "1234567890123.4567"]) {
      expect(valeurKpiSchema.safeParse(recu(texte)).success, texte).toBe(false);
    }
    expect(
      kpiMesureSchema.safeParse(
        JSON.parse('{"date_mesure":"2026-01-31","valeur":123456789012345.123456}'),
      ).success,
    ).toBe(false);
    expect(kpiCibleSchema.safeParse({ valeur: 0.1234567, a_partir_de: "2026-01-01" }).success).toBe(
      false,
    );
  });

  it("accepte jusqu'à 15 chiffres significatifs, exacts", () => {
    for (const v of [
      123456789012345, -123456789012345, 12345678901234.5, 123456789.123456, 0.000001,
    ]) {
      const r = valeurKpiSchema.safeParse(v);
      expect(r.success, String(v)).toBe(true);
      expect(String(r.data)).toBe(String(v));
    }
    expect(valeurKpiSchema.safeParse(1e15).success).toBe(false);
    expect(valeurKpiSchema.safeParse(1e-7).success).toBe(false);
  });
});

describe("date d'arrêté du tableau de bord (non-régression : déni de service)", () => {
  it("bornée de 2000-01-01 à aujourd'hui + 366 jours", () => {
    expect(kpiTableauQuerySchema.safeParse({}).success).toBe(true);
    expect(kpiTableauQuerySchema.safeParse({ date: "2000-01-01" }).success).toBe(true);
    expect(
      kpiTableauQuerySchema.safeParse({ date: jour(HORIZON_ARRETE_KPI_JOURS - 1) }).success,
    ).toBe(true);
    for (const date of ["2190-01-01", "9999-12-31", "0001-01-01", "1999-12-31", jour(400)]) {
      expect(kpiTableauQuerySchema.safeParse({ date }).success, date).toBe(false);
    }
  });
});
