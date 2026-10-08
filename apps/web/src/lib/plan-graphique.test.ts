import { describe, expect, it } from "vitest";
import {
  descriptionGraphique,
  geometrieTresorerie,
  MARQUEURS,
  pointsTriangle,
  seriesTresorerie,
  TRAITS,
  type SerieTresorerie,
} from "./plan-graphique";
import type { ResultatPlan } from "./plan-modele";

function plan(tresoreries: number[]): ResultatPlan {
  return {
    annees: tresoreries.map((t, i) => ({
      exercice: 2027 + i,
      bilan: { tresorerieNette: t },
    })),
    alertes: [],
  } as unknown as ResultatPlan;
}

const serie = (scenario: SerieTresorerie["scenario"], valeurs: number[]): SerieTresorerie => ({
  scenario,
  libelle: scenario,
  points: valeurs.map((valeur, i) => ({ exercice: 2027 + i, valeur })),
});

describe("séries de trésorerie", () => {
  it("trésorerie nette de clôture du moteur, telle quelle, pour les trois scénarios", () => {
    const s = seriesTresorerie({
      base: plan([10, -5]),
      optimiste: plan([20, 30]),
      pessimiste: plan([-1, -2]),
    });
    expect(s.map((x) => x.scenario)).toEqual(["base", "optimiste", "pessimiste"]);
    expect(s[0]!.libelle).toBe("Base");
    expect(s[0]!.points).toEqual([
      { exercice: 2027, valeur: 10 },
      { exercice: 2028, valeur: -5 },
    ]);
  });
});

describe("géométrie", () => {
  it("le zéro est toujours dans le repère ; valeurs positives au-dessus, négatives au-dessous", () => {
    const g = geometrieTresorerie([serie("base", [100, -50, 0])])!;
    expect(g.haut).toBeLessThan(g.yZero);
    expect(g.yZero).toBeLessThan(g.bas);
    const [a, b, c] = g.series[0]!.marqueurs;
    expect(a!.y).toBe(g.haut);
    expect(b!.y).toBe(g.bas);
    expect(c!.y).toBe(g.yZero);
    expect(a!.valeur).toBe(100);
    expect(g.abscisses.map((x) => x.exercice)).toEqual([2027, 2028, 2029]);
    expect(g.abscisses[0]!.x).toBe(g.gauche);
    expect(g.abscisses[2]!.x).toBe(g.droite);
    expect(g.series[0]!.points.split(" ")).toHaveLength(3);
  });

  it("valeurs toutes positives : le zéro est en bas", () => {
    const g = geometrieTresorerie([serie("base", [10, 20])])!;
    expect(g.yZero).toBe(g.bas);
  });

  it("un seul exercice centré ; toutes valeurs nulles sans division par zéro", () => {
    const g = geometrieTresorerie([serie("base", [0])])!;
    expect(g.abscisses[0]!.x).toBe((g.gauche + g.droite) / 2);
    expect(Number.isFinite(g.series[0]!.marqueurs[0]!.y)).toBe(true);
  });

  it("rien à tracer : null", () => {
    expect(geometrieTresorerie([])).toBeNull();
    expect(geometrieTresorerie([serie("base", [])])).toBeNull();
  });

  it("formes de marqueurs distinctes par scénario", () => {
    expect(new Set(Object.values(MARQUEURS)).size).toBe(3);
    expect(pointsTriangle(10, 10, 5)).toBe("10,5 15,15 5,15");
  });
});

describe("description du graphique pour les lecteurs d'écran", () => {
  it("motifs des séries et années de trésorerie négative (alertes du moteur)", () => {
    const alerte = (exercice: number) => ({
      code: "TRESORERIE_NEGATIVE",
      gravite: "critique" as const,
      annee: exercice - 2026,
      exercice,
      montant: -1,
      seuil: 0,
    });
    const avec = (alertes: ReturnType<typeof alerte>[]) =>
      ({ ...plan([1, -1]), alertes }) as unknown as ResultatPlan;
    const d = descriptionGraphique({
      base: avec([alerte(2028)]),
      optimiste: avec([]),
      pessimiste: avec([alerte(2027), alerte(2028)]),
    });
    expect(d).toContain(`base en ${TRAITS.base}`);
    expect(d).toContain("Trésorerie négative : base en 2028 ; pessimiste en 2027, 2028.");
    expect(
      descriptionGraphique({ base: avec([]), optimiste: avec([]), pessimiste: avec([]) }),
    ).toContain("reste positive ou nulle dans les trois scénarios");
  });
});
