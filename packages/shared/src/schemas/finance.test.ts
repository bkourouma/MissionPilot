import { describe, expect, it } from "vitest";
import { aPermission, ROLES } from "../roles";
import {
  encaissementCreationSchema,
  exportComptableQuerySchema,
  indicateursQuerySchema,
  parametresRelanceSchema,
  planComptableSchema,
  rentabiliteQuerySchema,
} from "./finance";

const UUID = "7f1c1c56-6a1a-4e6c-9b1e-2f3b4c5d6e7f";
const base = { client_id: UUID, date: "2026-10-01", montant: 1000, mode: "virement" };

describe("schémas de la finance (FIN-09 à FIN-13)", () => {
  it("encaissement : Mobile Money avec opérateur et référence, chèque avec référence", () => {
    expect(encaissementCreationSchema.safeParse(base).success).toBe(true);
    expect(
      encaissementCreationSchema.safeParse({
        ...base,
        mode: "mobile_money",
        operateur: "orange_money",
        reference: "OM-1",
      }).success,
    ).toBe(true);
    for (const e of [
      { ...base, mode: "mobile_money", reference: "OM-1" },
      { ...base, operateur: "wave" },
      { ...base, mode: "cheque" },
      { ...base, montant: 0 },
      { ...base, montant: 1.5 },
      { ...base, date: "2101-01-01" },
      { ...base, reference: "a\nb" },
      {
        ...base,
        imputations: [
          { facture_id: UUID, montant: 1 },
          { facture_id: UUID, montant: 2 },
        ],
      },
      { ...base, autre: 1 },
    ]) {
      expect(encaissementCreationSchema.safeParse(e).success, JSON.stringify(e)).toBe(false);
    }
  });

  it("paramètres de relance : 1 à 3 délais strictement croissants", () => {
    expect(parametresRelanceSchema.safeParse({ delais_relance: [7, 15, 30] }).success).toBe(true);
    for (const d of [[], [15, 7], [7, 7], [1, 2, 3, 4], [0], [400]]) {
      expect(parametresRelanceSchema.safeParse({ delais_relance: d }).success, String(d)).toBe(
        false,
      );
    }
    expect(parametresRelanceSchema.safeParse({}).success).toBe(false);
  });

  it("périodes bornées et cohérentes (rentabilité, indicateurs, export)", () => {
    expect(rentabiliteQuerySchema.safeParse({ du: "2026-01-01", au: "2026-12-31" }).success).toBe(
      true,
    );
    expect(rentabiliteQuerySchema.safeParse({ du: "2026-12-31", au: "2026-01-01" }).success).toBe(
      false,
    );
    expect(indicateursQuerySchema.safeParse({ du: "2026-01-01", au: "2027-01-02" }).success).toBe(
      false,
    );
    expect(
      exportComptableQuerySchema.safeParse({
        du: "2026-01-01",
        au: "2026-01-31",
        separateur: "virgule",
      }).success,
    ).toBe(false);
    expect(exportComptableQuerySchema.parse({ du: "2026-01-01", au: "2026-01-31" })).toMatchObject({
      format: "csv",
      separateur: "point_virgule",
      decimale: "virgule",
      bom: "non",
    });
  });

  it("plan comptable : comptes et journaux contrôlés", () => {
    expect(planComptableSchema.safeParse({ comptes: { clients: "4111" } }).success).toBe(true);
    for (const p of [
      {},
      { comptes: { clients: "=1" } },
      { comptes: { inconnu: "411" } },
      { journaux: { ventes: "VENTES99" } },
    ]) {
      expect(planComptableSchema.safeParse(p).success, JSON.stringify(p)).toBe(false);
    }
  });

  it("droits de la finance V1 : matrice des 8 rôles", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      ROLES.filter((r) => aPermission([r], p)).sort();
    expect(qui("encaissement.gerer")).toEqual(["associe", "gestionnaire"]);
    expect(qui("export.comptable")).toEqual(["associe", "gestionnaire"]);
    expect(qui("indicateurs.cabinet")).toEqual(["associe", "directeur_mission", "gestionnaire"]);
  });
});
