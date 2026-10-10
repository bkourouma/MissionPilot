import { describe, expect, it } from "vitest";
import { composerOrdreDuJourKpi, MAX_POINTS_REVUE_KPI, type KpiRevueKpi } from "./revue";

const kpi = (id: string, extra: Partial<KpiRevueKpi> = {}): KpiRevueKpi => ({
  id,
  libelle: `KPI ${id}`,
  statut: "vert",
  evolution: "stable",
  nombreAlertes: 0,
  qualite: "bon",
  ...extra,
});

const vide = { dateReference: "2026-06-15", kpis: [], actions: [], decisionsOuvertes: [] };

describe("ordre du jour d'une revue de performance", () => {
  it("sans matière : ouverture et décisions seulement", () => {
    const o = composerOrdreDuJourKpi({ ...vide, kpis: [kpi("a")] });
    expect(o.points.map((p) => [p.rang, p.code, p.priorite])).toEqual([
      [1, "OUVERTURE", 0],
      [2, "DECISIONS_A_PRENDRE", 0],
    ]);
    expect(o.dureeTotaleMinutes).toBe(15);
    expect(o.ecartes).toBe(0);
  });

  it("classe par priorité : KPI rouge, action en retard, décisions, dégradation, orange, qualité, non mesuré", () => {
    const o = composerOrdreDuJourKpi({
      dateReference: "2026-06-15",
      kpis: [
        kpi("rouge", { statut: "rouge", nombreAlertes: 2 }),
        kpi("orange", { statut: "orange" }),
        kpi("degrade", { statut: "vert", evolution: "degradation" }),
        kpi("rien", { statut: "non_mesure", qualite: "faible" }),
        kpi("sain"),
      ],
      actions: [
        {
          id: "retard",
          libelle: "Relancer les clients",
          kpiId: "rouge",
          echeance: "2026-06-05",
          statut: "en_cours",
          efficacite: null,
        },
        {
          id: "inefficace",
          libelle: "Remise exceptionnelle",
          kpiId: "orange",
          echeance: "2026-05-01",
          statut: "terminee",
          efficacite: "inefficace",
        },
        {
          id: "bonne",
          libelle: "Bonne action",
          kpiId: "orange",
          echeance: "2026-05-01",
          statut: "terminee",
          efficacite: "efficace",
        },
        {
          id: "future",
          libelle: "À venir",
          kpiId: "orange",
          echeance: "2026-07-01",
          statut: "a_faire",
          efficacite: null,
        },
        {
          id: "abandon",
          libelle: "Abandonnée",
          kpiId: "orange",
          echeance: "2026-01-01",
          statut: "abandonnee",
          efficacite: null,
        },
      ],
      decisionsOuvertes: [
        { id: "d1", libelle: "Réviser la grille", echeance: "2026-06-01" },
        { id: "d2", libelle: "Embaucher", echeance: null },
      ],
    });
    expect(o.points.map((p) => [p.code, p.priorite])).toEqual([
      ["OUVERTURE", 0],
      ["KPI_ROUGE", 120],
      ["ACTION_EN_RETARD", 100],
      ["DECISION_OUVERTE", 95],
      ["DECISION_OUVERTE", 85],
      ["ACTION_INEFFICACE", 80],
      ["KPI_DEGRADATION", 70],
      ["KPI_ORANGE", 60],
      ["QUALITE_DONNEES", 50],
      ["KPI_NON_MESURE", 40],
      ["DECISIONS_A_PRENDRE", 0],
    ]);
  });

  it("durées : 10 minutes pour un KPI rouge, 5 sinon", () => {
    const o = composerOrdreDuJourKpi({
      ...vide,
      kpis: [kpi("r", { statut: "rouge" }), kpi("o", { statut: "orange" })],
    });
    expect(o.points.map((p) => p.dureeMinutes)).toEqual([5, 10, 5, 10]);
    expect(o.dureeTotaleMinutes).toBe(30);
  });

  it("le retard d'une action est plafonné à 30 jours de priorité", () => {
    const o = composerOrdreDuJourKpi({
      ...vide,
      actions: [
        {
          id: "a",
          libelle: "Très en retard",
          kpiId: "k",
          echeance: "2025-01-01",
          statut: "a_faire",
          efficacite: null,
        },
      ],
    });
    expect(o.points[1]?.priorite).toBe(120);
    expect(o.points[1]?.actionId).toBe("a");
    expect(o.points[1]?.kpiId).toBe("k");
  });

  it("départage à priorité égale par code puis par ordre d'entrée", () => {
    const o = composerOrdreDuJourKpi({
      ...vide,
      kpis: [kpi("b", { statut: "orange" }), kpi("a", { statut: "orange" })],
    });
    expect(o.points.slice(1, 3).map((p) => p.kpiId)).toEqual(["b", "a"]);
  });

  it("borne le nombre de points et compte les candidats écartés", () => {
    const kpis = Array.from({ length: 60 }, (_, i) => kpi(`k${i}`, { statut: "orange" }));
    const o = composerOrdreDuJourKpi({ ...vide, kpis });
    expect(o.points).toHaveLength(MAX_POINTS_REVUE_KPI);
    expect(o.ecartes).toBe(60 - (MAX_POINTS_REVUE_KPI - 2));
    expect(o.points[o.points.length - 1]?.code).toBe("DECISIONS_A_PRENDRE");
  });

  it("refuse un nombre d'alertes qui n'est pas un entier positif ou nul", () => {
    for (const nombreAlertes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        composerOrdreDuJourKpi({ ...vide, kpis: [kpi("a", { statut: "rouge", nombreAlertes })] }),
      ).toThrow(/nombre d'alertes/);
    }
  });

  it("refuse une date invalide", () => {
    expect(() => composerOrdreDuJourKpi({ ...vide, dateReference: "demain" })).toThrow();
  });
});
