import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import { DUREE_PLAN_JOURS, planCentJours, type ActionCentJours } from "./plan-100-jours";

const a = (
  id: string,
  jourDebut: number,
  jourFin: number,
  statut: ActionCentJours["statut"],
  responsableId: string | null,
  extra: Partial<ActionCentJours> = {},
): ActionCentJours => ({
  id,
  jourDebut,
  jourFin,
  statut,
  responsableId,
  reliePlan: false,
  relieKpi: false,
  ...extra,
});

const actions: ActionCentJours[] = [
  a("A", 0, 10, "terminee", "u1", { relieKpi: true }),
  a("B", 5, 30, "en_cours", "u1", { reliePlan: true }),
  a("C", 31, 45, "a_faire", "u1"),
  a("D", 50, 60, "a_faire", null),
  a("E", 61, 100, "a_faire", "u1"),
];

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDueDiligence);
    return (e as ErreurDueDiligence).code;
  }
  return undefined;
}

describe("planCentJours", () => {
  it("cas du SPEC-3b §5.8", () => {
    const r = planCentJours({ dateOperation: "2026-03-01", aujourdhui: "2026-04-15", actions });
    expect(r.actions.map((x) => [x.id, x.dateDebut, x.dateFin])).toEqual([
      ["A", "2026-03-01", "2026-03-11"],
      ["B", "2026-03-06", "2026-03-31"],
      ["C", "2026-04-01", "2026-04-15"],
      ["D", "2026-04-20", "2026-04-30"],
      ["E", "2026-05-01", "2026-06-09"],
    ]);
    expect(r.jourCourant).toBe(45);
    expect(r.enRetard).toEqual(["B"]);
    expect(r.parPhase).toEqual({
      jours_0_30: { total: 2, terminees: 1 },
      jours_31_60: { total: 2, terminees: 0 },
      jours_61_100: { total: 1, terminees: 0 },
    });
    expect(r.total).toBe(5);
    expect(r.terminees).toBe(1);
    expect(r.tauxRealisationBp).toBe(2_000);
    expect(r.sansResponsable).toEqual(["D"]);
    expect(r.sansIndicateur).toEqual(["B", "C", "D", "E"]);
    expect(r.sansPlan).toEqual(["A", "C", "D", "E"]);
    expect(DUREE_PLAN_JOURS).toBe(100);
  });

  it("bornes de phase", () => {
    const phase = (jour: number) =>
      planCentJours({
        dateOperation: null,
        aujourdhui: "2026-01-01",
        actions: [a("x", jour, 100, "a_faire", null)],
      }).actions[0]?.phase;
    expect(phase(0)).toBe("jours_0_30");
    expect(phase(30)).toBe("jours_0_30");
    expect(phase(31)).toBe("jours_31_60");
    expect(phase(60)).toBe("jours_31_60");
    expect(phase(61)).toBe("jours_61_100");
    expect(phase(100)).toBe("jours_61_100");
  });

  it("sans date d'opération : dates nulles, aucun retard, jour courant nul", () => {
    const r = planCentJours({ dateOperation: null, aujourdhui: "2026-04-15", actions });
    expect(r.actions.every((x) => x.dateDebut === null && x.dateFin === null && !x.enRetard)).toBe(
      true,
    );
    expect(r.enRetard).toEqual([]);
    expect(r.jourCourant).toBeNull();
  });

  it("jour courant négatif avant l'opération ; une action terminée n'est jamais en retard", () => {
    const avant = planCentJours({ dateOperation: "2026-03-01", aujourdhui: "2026-02-20", actions });
    expect(avant.jourCourant).toBe(-9);
    expect(avant.enRetard).toEqual([]);
    const apres = planCentJours({ dateOperation: "2026-03-01", aujourdhui: "2027-01-01", actions });
    expect(apres.enRetard).toEqual(["B", "C", "D", "E"]);
  });

  it("plan vide : taux nul ; tri par jour de début puis id", () => {
    const vide = planCentJours({
      dateOperation: "2026-03-01",
      aujourdhui: "2026-03-02",
      actions: [],
    });
    expect(vide.tauxRealisationBp).toBeNull();
    expect(vide.total).toBe(0);
    const tri = planCentJours({
      dateOperation: null,
      aujourdhui: "2026-03-02",
      actions: [
        a("b", 5, 6, "a_faire", null),
        a("a", 5, 6, "a_faire", null),
        a("c", 1, 2, "a_faire", null),
      ],
    });
    expect(tri.actions.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("taux arrondi : 1 sur 3 = 3 333", () => {
    const r = planCentJours({
      dateOperation: null,
      aujourdhui: "2026-03-02",
      actions: [
        a("a", 0, 1, "terminee", null),
        a("b", 0, 1, "a_faire", null),
        a("c", 0, 1, "bloquee", null),
      ],
    });
    expect(r.tauxRealisationBp).toBe(3_333);
  });

  it("entrées invalides", () => {
    const run = (acts: ActionCentJours[], op: string | null = "2026-03-01", jour = "2026-03-02") =>
      code(() => planCentJours({ dateOperation: op, aujourdhui: jour, actions: acts }));
    expect(run([a("x", -1, 5, "a_faire", null)])).toBe("PARAMETRE_INVALIDE");
    expect(run([a("x", 0, 101, "a_faire", null)])).toBe("PARAMETRE_INVALIDE");
    expect(run([a("x", 0.5, 5, "a_faire", null)])).toBe("PARAMETRE_INVALIDE");
    expect(run([a("x", 6, 5, "a_faire", null)])).toBe("PARAMETRE_INVALIDE");
    expect(run([a("x", 1, 5, "inconnu" as never, null)])).toBe("PARAMETRE_INVALIDE");
    expect(run([a("x", 1, 5, "a_faire", null), a("x", 1, 5, "a_faire", null)])).toBe(
      "ENTREE_INVALIDE",
    );
    expect(run([], "2026-02-30")).toBe("DATE_INVALIDE");
    expect(run([], "pas une date")).toBe("DATE_INVALIDE");
    expect(run([], "2026-03-01", "2026-13-01")).toBe("DATE_INVALIDE");
  });
});
