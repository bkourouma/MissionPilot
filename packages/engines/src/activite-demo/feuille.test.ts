import { describe, expect, it } from "vitest";
import {
  appliquerPlanFeuilleDemo,
  capaciteRestanteTacheDemo,
  planifierFeuilleDemo,
  type AffectationSemaineDemo,
  type EntreeFeuilleDemo,
  type LigneFeuilleDemo,
  type PlanFeuilleDemo,
  type TacheCapaciteDemo,
} from "./index";

const LUNDI = "2026-11-02";
const MOI = "col-a";
const AUTRE = "col-b";

function tache(sur: Partial<TacheCapaciteDemo> = {}): TacheCapaciteDemo {
  return {
    tacheId: "t1",
    missionId: "m1",
    budgetCentiemes: 10000,
    realiseCentiemes: 0,
    attenteCentiemes: 0,
    declarations: {},
    planifieCentiemes: 0,
    planifieParCollaborateur: {},
    missionEnDerive: false,
    ...sur,
  };
}

/** Affectation de 5 jours du lundi au vendredi de la semaine, sur t1. */
function affectation(sur: Partial<AffectationSemaineDemo> = {}): AffectationSemaineDemo {
  return {
    id: "a1",
    personneId: MOI,
    tacheId: "t1",
    joursAlloues: 5,
    debut: "2026-11-02",
    fin: "2026-11-06",
    missionId: "m1",
    ...sur,
  };
}

function entree(sur: Partial<EntreeFeuilleDemo> = {}): EntreeFeuilleDemo {
  return {
    lundi: LUNDI,
    collaborateurId: MOI,
    capacitePct: 100,
    calendrier: {},
    moisClotures: [],
    absences: [],
    affectations: [affectation()],
    taches: new Map([["t1", tache()]]),
    activiteInterneId: "interne",
    ...sur,
  };
}

const taches = (...liste: TacheCapaciteDemo[]): Map<string, TacheCapaciteDemo> =>
  new Map(liste.map((t): [string, TacheCapaciteDemo] => [t.tacheId, t]));

const ligneTache = (date: string, centiemes: number, tacheId = "t1"): LigneFeuilleDemo => ({
  date,
  tacheId,
  missionId: tacheId === "t2" ? "m2" : "m1",
  activiteId: null,
  centiemes,
});

const ligneInterne = (date: string, centiemes: number): LigneFeuilleDemo => ({
  date,
  tacheId: null,
  missionId: null,
  activiteId: "interne",
  centiemes,
});

const somme = (lignes: readonly LigneFeuilleDemo[]): number =>
  lignes.reduce((s, l) => s + l.centiemes, 0);
const mission = (p: PlanFeuilleDemo): number => somme(p.lignes.filter((l) => l.tacheId !== null));
const interne = (p: PlanFeuilleDemo): number => somme(p.lignes.filter((l) => l.tacheId === null));
const dates = (p: PlanFeuilleDemo): string[] => [...new Set(p.lignes.map((l) => l.date))];

/** Feuilles successives de deux collaborateurs sur la même tâche, la seconde après report. */
function deuxFeuilles(budget: number, realise: number, capacitePct: number): PlanFeuilleDemo[] {
  const t = tache({ budgetCentiemes: budget, realiseCentiemes: realise, attenteCentiemes: 10 });
  const depart = taches(t);
  const p1 = planifierFeuilleDemo(entree({ taches: depart, capacitePct }));
  const autre = [affectation({ id: "a2", personneId: AUTRE })];
  const apres = appliquerPlanFeuilleDemo(depart, MOI, p1);
  const p2 = planifierFeuilleDemo(
    entree({ collaborateurId: AUTRE, affectations: autre, taches: apres, capacitePct }),
  );
  return [p1, p2];
}

/** Lignes positives au pas de 50, au plus une journée par jour, part mission sous 80 %. */
function verifierPlan(p: PlanFeuilleDemo): void {
  expect(p.lignes.every((l) => l.centiemes > 0 && l.centiemes % 50 === 0)).toBe(true);
  for (const d of dates(p)) {
    const jour = p.lignes.filter((l) => l.date === d);
    expect(somme(jour)).toBeLessThanOrEqual(100);
  }
  expect(mission(p)).toBeLessThanOrEqual(400);
}

describe("capacité restante d'une tâche (DT5)", () => {
  it("libre = budget − réalisé − attente − déjà planifié, jamais négatif", () => {
    const t = tache({
      budgetCentiemes: 1000,
      realiseCentiemes: 300,
      attenteCentiemes: 100,
      planifieCentiemes: 200,
    });
    expect(capaciteRestanteTacheDemo(t, MOI)).toBe(400);
    const depassee = tache({ budgetCentiemes: 100, realiseCentiemes: 300 });
    expect(capaciteRestanteTacheDemo(depassee, MOI)).toBe(0);
  });

  it("déclaration propre : min(libre, d − déjà planifié par soi)", () => {
    const declaree = { declarations: { [MOI]: 300 }, planifieParCollaborateur: { [MOI]: 100 } };
    expect(capaciteRestanteTacheDemo(tache(declaree), MOI)).toBe(200);
    expect(capaciteRestanteTacheDemo(tache({ declarations: { [MOI]: 5000 } }), MOI)).toBe(5000);
    const bornee = tache({ budgetCentiemes: 600, declarations: { [MOI]: 5000 } });
    expect(capaciteRestanteTacheDemo(bornee, MOI)).toBe(600);
    const depasse = { declarations: { [MOI]: 100 }, planifieParCollaborateur: { [MOI]: 150 } };
    expect(capaciteRestanteTacheDemo(tache(depasse), MOI)).toBe(0);
  });

  it("déclaration d'un autre collaborateur : 0 ; mission en dérive : libre", () => {
    expect(capaciteRestanteTacheDemo(tache({ declarations: { [AUTRE]: 500 } }), MOI)).toBe(0);
    const derive = tache({ declarations: { [AUTRE]: 500 }, missionEnDerive: true });
    expect(capaciteRestanteTacheDemo(derive, MOI)).toBe(10000);
  });

  it("refuse des centièmes négatifs ou non entiers", () => {
    const invalides: Partial<TacheCapaciteDemo>[] = [
      { budgetCentiemes: -1 },
      { realiseCentiemes: 1.5 },
      { attenteCentiemes: -50 },
      { planifieCentiemes: -1 },
      { planifieParCollaborateur: { [MOI]: -1 } },
      { declarations: { [MOI]: Number.NaN } },
    ];
    for (const sur of invalides) {
      expect(() => capaciteRestanteTacheDemo(tache(sur), MOI)).toThrow(RangeError);
    }
  });
});

describe("feuille de la semaine (DT7)", () => {
  it("5 jours, une tâche suffisante : 400 centièmes sur la mission, 100 en interne", () => {
    const plan = planifierFeuilleDemo(entree());
    expect(plan.motif).toBe("ok");
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 100),
      ligneTache("2026-11-04", 100),
      ligneTache("2026-11-05", 100),
      ligneInterne("2026-11-06", 100),
    ]);
    expect(plan.consommations).toEqual([{ tacheId: "t1", missionId: "m1", centiemes: 400 }]);
    expect(plan.redeclarations).toEqual([]);
  });

  it("mercredi férié : quatre jours, quota de 80 % au pas inférieur", () => {
    const plan = planifierFeuilleDemo(entree({ calendrier: { feries: ["2026-11-04"] } }));
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 100),
      ligneTache("2026-11-05", 100),
      ligneInterne("2026-11-06", 100),
    ]);
  });

  it("absence validée d'un jour : le jour est sauté ; demi-journée : la moitié", () => {
    const journee = planifierFeuilleDemo(
      entree({ absences: [{ debut: "2026-11-03", fin: "2026-11-03" }] }),
    );
    expect(dates(journee)).toEqual(["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(mission(journee)).toBe(300);
    expect(interne(journee)).toBe(100);

    const demi = planifierFeuilleDemo(
      entree({ absences: [{ debut: "2026-11-03", fin: "2026-11-03", fractionJour: 0.5 }] }),
    );
    expect(demi.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 50),
      ligneTache("2026-11-04", 100),
      ligneTache("2026-11-05", 100),
      ligneInterne("2026-11-06", 100),
    ]);
  });

  it("capacité de 50 % : des demi-journées", () => {
    const plan = planifierFeuilleDemo(entree({ capacitePct: 50 }));
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 50),
      ligneTache("2026-11-03", 50),
      ligneTache("2026-11-04", 50),
      ligneTache("2026-11-05", 50),
      ligneInterne("2026-11-06", 50),
    ]);
  });

  it("capacité nulle : aucune ligne (capacite_nulle)", () => {
    const plan = planifierFeuilleDemo(entree({ capacitePct: 0 }));
    expect(plan).toEqual({
      lignes: [],
      consommations: [],
      redeclarations: [],
      motif: "capacite_nulle",
    });
    const absent = planifierFeuilleDemo(
      entree({ absences: [{ debut: "2026-11-02", fin: "2026-11-08" }] }),
    );
    expect(absent.motif).toBe("capacite_nulle");
  });

  it("mois clôturé : aucune ligne (aucun_jour) ; semaine à cheval : seuls les jours ouverts", () => {
    expect(planifierFeuilleDemo(entree({ moisClotures: ["2026-11"] })).motif).toBe("aucun_jour");
    const cheval = planifierFeuilleDemo(
      entree({
        lundi: "2026-11-30",
        moisClotures: ["2026-11"],
        affectations: [affectation({ debut: "2026-11-30", fin: "2026-12-04" })],
      }),
    );
    expect(cheval.lignes).toEqual([
      ligneTache("2026-12-01", 100),
      ligneTache("2026-12-02", 100),
      ligneTache("2026-12-03", 100),
      ligneInterne("2026-12-04", 100),
    ]);
  });

  it("semaine sans jour ouvré : aucun_jour", () => {
    const plan = planifierFeuilleDemo(entree({ calendrier: { joursTravailles: [] } }));
    expect(plan.motif).toBe("aucun_jour");
  });

  it("affectation commencée le mercredi : lundi et mardi en interne", () => {
    const plan = planifierFeuilleDemo(
      entree({ affectations: [affectation({ debut: "2026-11-04", joursAlloues: 3 })] }),
    );
    expect(plan.lignes).toEqual([
      ligneInterne("2026-11-02", 100),
      ligneInterne("2026-11-03", 100),
      ligneTache("2026-11-04", 100),
      ligneTache("2026-11-05", 100),
      ligneTache("2026-11-06", 100),
    ]);
  });

  it("tâche avec 150 centièmes restants : le reste du jour passe en interne", () => {
    const t = tache({ budgetCentiemes: 1150, realiseCentiemes: 900, attenteCentiemes: 100 });
    const plan = planifierFeuilleDemo(entree({ taches: taches(t) }));
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 50),
      ligneInterne("2026-11-03", 50),
      ligneInterne("2026-11-04", 100),
      ligneInterne("2026-11-05", 100),
      ligneInterne("2026-11-06", 100),
    ]);
    expect(plan.consommations).toEqual([{ tacheId: "t1", missionId: "m1", centiemes: 150 }]);
  });

  it("budget partagé entre deux collaborateurs : le second ne consomme que le reste", () => {
    const depart = taches(tache({ budgetCentiemes: 600 }));
    const premier = planifierFeuilleDemo(entree({ taches: depart }));
    expect(mission(premier)).toBe(400);
    const apres = appliquerPlanFeuilleDemo(depart, MOI, premier);
    expect(apres.get("t1")).toMatchObject({
      planifieCentiemes: 400,
      planifieParCollaborateur: { [MOI]: 400 },
    });
    expect(depart.get("t1")?.planifieCentiemes).toBe(0);
    const second = planifierFeuilleDemo(
      entree({
        collaborateurId: AUTRE,
        affectations: [affectation({ id: "a2", personneId: AUTRE })],
        taches: apres,
      }),
    );
    expect(second.consommations).toEqual([{ tacheId: "t1", missionId: "m1", centiemes: 200 }]);
    const fin = appliquerPlanFeuilleDemo(apres, AUTRE, second).get("t1");
    expect(fin?.planifieCentiemes).toBe(600);
    expect(fin?.planifieParCollaborateur).toEqual({ [MOI]: 400, [AUTRE]: 200 });
  });

  it("déclaration propre : consommée puis redéclarée à d − consommé", () => {
    const petite = planifierFeuilleDemo(
      entree({ taches: taches(tache({ declarations: { [MOI]: 300 } })) }),
    );
    expect(mission(petite)).toBe(300);
    expect(petite.redeclarations).toEqual([{ tacheId: "t1", missionId: "m1", centiemes: 0 }]);
    const grande = planifierFeuilleDemo(
      entree({ taches: taches(tache({ declarations: { [MOI]: 1000, [AUTRE]: 200 } })) }),
    );
    expect(mission(grande)).toBe(400);
    expect(grande.redeclarations).toEqual([{ tacheId: "t1", missionId: "m1", centiemes: 600 }]);
  });

  it("déclaration d'un autre collaborateur : la tâche est bloquée, toute la semaine en interne", () => {
    const plan = planifierFeuilleDemo(
      entree({ taches: taches(tache({ declarations: { [AUTRE]: 500 } })) }),
    );
    expect(mission(plan)).toBe(0);
    expect(interne(plan)).toBe(500);
    expect(plan.consommations).toEqual([]);
    expect(plan.redeclarations).toEqual([]);
  });

  it("mission en dérive : capacité libre, sans redéclaration", () => {
    const t = tache({ declarations: { [AUTRE]: 500, [MOI]: 100 }, missionEnDerive: true });
    const plan = planifierFeuilleDemo(entree({ taches: taches(t) }));
    expect(mission(plan)).toBe(400);
    expect(plan.redeclarations).toEqual([]);
  });

  it("sans activité interne : seule la part mission est écrite", () => {
    const plan = planifierFeuilleDemo(entree({ activiteInterneId: null }));
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 100),
      ligneTache("2026-11-04", 100),
      ligneTache("2026-11-05", 100),
    ]);
  });

  it("cabinet qui travaille le samedi : six jours, quota de 450", () => {
    const plan = planifierFeuilleDemo(
      entree({
        calendrier: { joursTravailles: [1, 2, 3, 4, 5, 6] },
        affectations: [affectation({ fin: "2026-11-07", joursAlloues: 6 })],
      }),
    );
    expect(plan.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-03", 100),
      ligneTache("2026-11-04", 100),
      ligneTache("2026-11-05", 100),
      ligneTache("2026-11-06", 50),
      ligneInterne("2026-11-06", 50),
      ligneInterne("2026-11-07", 100),
    ]);
  });

  it("deux tâches au plus par jour, une ligne par jour et par tâche", () => {
    const petites = taches(
      tache({ budgetCentiemes: 50 }),
      tache({ tacheId: "t2", missionId: "m2", budgetCentiemes: 50 }),
      tache({ tacheId: "t3", missionId: "m3", budgetCentiemes: 50 }),
    );
    const plan = planifierFeuilleDemo(
      entree({
        taches: petites,
        affectations: [
          affectation(),
          affectation({ id: "a1bis" }),
          affectation({ id: "a2", tacheId: "t2", missionId: "m2" }),
          affectation({ id: "a3", tacheId: "t3", missionId: "m3" }),
        ],
      }),
    );
    expect(plan.lignes.filter((l) => l.date === "2026-11-02")).toEqual([
      ligneTache("2026-11-02", 50),
      ligneTache("2026-11-02", 50, "t2"),
    ]);
    expect(plan.lignes.filter((l) => l.date === "2026-11-03")).toEqual([
      { date: "2026-11-03", tacheId: "t3", missionId: "m3", activiteId: null, centiemes: 50 },
      ligneInterne("2026-11-03", 50),
    ]);
    const cles = plan.lignes.map((l) => `${l.date}/${l.tacheId ?? l.activiteId}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("ignore les affectations d'un autre collaborateur et les tâches hors suivi", () => {
    const plan = planifierFeuilleDemo(
      entree({
        affectations: [
          affectation({ personneId: AUTRE }),
          affectation({ id: "a9", tacheId: "inconnue" }),
        ],
      }),
    );
    expect(mission(plan)).toBe(0);
    expect(interne(plan)).toBe(500);
  });

  it("entrées mélangées : même sortie", () => {
    const t1 = tache({ budgetCentiemes: 250 });
    const t2 = tache({ tacheId: "t2", missionId: "m2", budgetCentiemes: 10000 });
    const affectations = [
      affectation(),
      affectation({ id: "a2", tacheId: "t2", missionId: "m2", debut: "2026-11-04" }),
      affectation({ id: "a3", personneId: AUTRE }),
    ];
    const absences = [
      { debut: "2026-11-05", fin: "2026-11-05", fractionJour: 0.5 },
      { debut: "2026-11-03", fin: "2026-11-03" },
    ];
    const clotures = ["2026-09", "2026-10"];
    const a = planifierFeuilleDemo(
      entree({ taches: taches(t1, t2), affectations, absences, moisClotures: clotures }),
    );
    const b = planifierFeuilleDemo(
      entree({
        taches: taches(t2, t1),
        affectations: [...affectations].reverse(),
        absences: [...absences].reverse(),
        moisClotures: [...clotures].reverse(),
      }),
    );
    expect(b).toEqual(a);
    expect(a.lignes).toEqual([
      ligneTache("2026-11-02", 100),
      ligneTache("2026-11-04", 100, "t2"),
      ligneTache("2026-11-05", 50, "t2"),
      ligneInterne("2026-11-06", 100),
    ]);
  });

  it("propriété : jamais plus que budget − réalisé − attente, au pas, au plus un jour par jour", () => {
    for (const budget of [0, 30, 50, 120, 400, 10000]) {
      for (const realise of [0, 20, 100]) {
        for (const capacitePct of [0, 50, 80, 100]) {
          const plans = deuxFeuilles(budget, realise, capacitePct);
          const consomme = plans.reduce((s, p) => s + mission(p), 0);
          expect(consomme).toBeLessThanOrEqual(Math.max(0, budget - realise - 10));
          for (const p of plans) verifierPlan(p);
        }
      }
    }
  });

  it("refuse une semaine qui ne commence pas un lundi", () => {
    expect(() => planifierFeuilleDemo(entree({ lundi: "2026-11-03" }))).toThrow(RangeError);
  });

  it("le report refuse une tâche absente du suivi", () => {
    const plan = planifierFeuilleDemo(entree());
    expect(() => appliquerPlanFeuilleDemo(new Map(), MOI, plan)).toThrow(RangeError);
  });
});
