import { describe, expect, it } from "vitest";
import {
  CycleDependancesError,
  type Dependance,
  type TachePlanifiee,
  calculerDatesAuPlusTot,
  decalerPhase,
  ordonnerTaches,
} from "./recalage";

const TACHES: TachePlanifiee[] = [
  { id: "A", debut: "2024-01-01", dureeJoursOuvres: 5, phaseId: "p1" },
  { id: "B", debut: "2024-01-01", dureeJoursOuvres: 3, phaseId: "p2" },
  { id: "C", debut: "2024-01-01", dureeJoursOuvres: 1, phaseId: "p2" },
  { id: "D", debut: "2024-01-06", dureeJoursOuvres: 2 },
];
const DEPS: Dependance[] = [
  { predecesseur: "A", successeur: "B" },
  { predecesseur: "B", successeur: "C", decalage: 2 },
];

describe("dates au plus tôt (PLN-03)", () => {
  it("enchaîne fin → début en jours ouvrés avec décalage", () => {
    const dates = calculerDatesAuPlusTot(TACHES, DEPS);
    expect(Object.fromEntries(dates)).toEqual({
      A: { debut: "2024-01-01", fin: "2024-01-05" },
      B: { debut: "2024-01-08", fin: "2024-01-10" },
      C: { debut: "2024-01-15", fin: "2024-01-15" },
      D: { debut: "2024-01-08", fin: "2024-01-09" }, // début un samedi → lundi
    });
  });

  it("respecte un début souhaité plus tardif que la contrainte", () => {
    const taches = [
      TACHES[0] as TachePlanifiee,
      { id: "B", debut: "2024-01-22", dureeJoursOuvres: 1 },
    ];
    expect(calculerDatesAuPlusTot(taches, [DEPS[0] as Dependance]).get("B")?.debut).toBe(
      "2024-01-22",
    );
  });

  it("prend le plus tardif de plusieurs prédécesseurs et accepte un chevauchement", () => {
    const taches = [...TACHES, { id: "E", debut: "2024-01-01", dureeJoursOuvres: 1 }];
    const deps = [
      ...DEPS,
      { predecesseur: "A", successeur: "E" },
      { predecesseur: "B", successeur: "E", decalage: -1 },
    ];
    expect(calculerDatesAuPlusTot(taches, deps).get("E")?.debut).toBe("2024-01-10");
  });

  it("saute les fériés du calendrier", () => {
    const dates = calculerDatesAuPlusTot(TACHES, DEPS, { feries: ["2024-01-08"] });
    expect(dates.get("B")).toEqual({ debut: "2024-01-09", fin: "2024-01-11" });
  });

  it("détecte un cycle avec une erreur explicite", () => {
    const deps = [...DEPS, { predecesseur: "C", successeur: "A" }];
    expect(() => ordonnerTaches(TACHES, deps)).toThrow(CycleDependancesError);
    let erreur: unknown = null;
    try {
      calculerDatesAuPlusTot(TACHES, deps);
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(CycleDependancesError);
    expect((erreur as CycleDependancesError).tachesEnCycle).toEqual(["A", "B", "C"]);
    expect((erreur as Error).message).toMatch(/Cycle de dépendances/);
    expect(() => ordonnerTaches(TACHES, [{ predecesseur: "D", successeur: "D" }])).toThrow(/D/);
  });

  it("refuse les données incohérentes", () => {
    expect(() => ordonnerTaches(TACHES, [{ predecesseur: "A", successeur: "Z" }])).toThrow(
      /inconnue/,
    );
    expect(() => ordonnerTaches([...TACHES, TACHES[0] as TachePlanifiee], [])).toThrow(/double/);
    expect(() =>
      ordonnerTaches([{ id: "X", debut: "2024-01-01", dureeJoursOuvres: 0 }], []),
    ).toThrow(/Durée/);
    expect(() =>
      ordonnerTaches([{ id: "X", debut: "2024-01-01", dureeJoursOuvres: 1.5 }], []),
    ).toThrow(/Durée/);
  });
});

describe("décalage d'une phase (PLN-09)", () => {
  const affectations = [
    { id: "x", tacheId: "B", personneId: "awa" },
    { id: "y", tacheId: "D", personneId: "koffi" },
  ];

  it("recale les dépendantes et renvoie les affectations impactées", () => {
    const r = decalerPhase({
      taches: TACHES,
      dependances: DEPS,
      phaseId: "p1",
      decalageJoursOuvres: 2,
      affectations,
    });
    expect(r.tachesDecalees.map((t) => [t.id, t.avant.debut, t.apres.debut])).toEqual([
      ["A", "2024-01-01", "2024-01-03"],
      ["B", "2024-01-08", "2024-01-10"],
      ["C", "2024-01-15", "2024-01-17"],
    ]);
    expect(r.dates.get("D")?.debut).toBe("2024-01-08");
    expect(r.affectationsImpactees).toEqual([affectations[0]]);
  });

  it("n'avance pas une phase contrainte par ses prédécesseurs", () => {
    const r = decalerPhase({
      taches: TACHES,
      dependances: DEPS,
      phaseId: "p2",
      decalageJoursOuvres: -5,
      affectations,
      calendrier: {},
    });
    expect(r.tachesDecalees).toEqual([]);
    expect(r.affectationsImpactees).toEqual([]);
  });

  it("ne déplace rien pour un décalage nul", () => {
    const r = decalerPhase({
      taches: TACHES,
      dependances: [],
      phaseId: "p2",
      decalageJoursOuvres: 0,
      affectations,
    });
    expect(r.tachesDecalees).toEqual([]);
    expect(r.affectationsImpactees).toEqual([]);
  });

  it("avance une phase libre", () => {
    const libre = decalerPhase({
      taches: [{ id: "Z", debut: "2024-01-10", dureeJoursOuvres: 1, phaseId: "p9" }],
      dependances: [],
      phaseId: "p9",
      decalageJoursOuvres: -2,
      affectations: [{ tacheId: "Z" }],
    });
    expect(libre.tachesDecalees).toHaveLength(1);
    expect(libre.tachesDecalees[0]?.avant).toEqual({ debut: "2024-01-10", fin: "2024-01-10" });
    expect(libre.tachesDecalees[0]?.apres).toEqual({ debut: "2024-01-08", fin: "2024-01-08" });
    expect(libre.affectationsImpactees).toEqual([{ tacheId: "Z" }]);
  });
});
