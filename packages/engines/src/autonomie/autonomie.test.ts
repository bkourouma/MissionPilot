import { describe, expect, it } from "vitest";
import * as autonomie from "./index";
import {
  ErreurAutonomie,
  estNiveauAutonomie,
  evaluerPromotion,
  niveauEffectif,
  rangNiveauAutonomie,
  retrogradationAuto,
  statistiquesAutonomie,
  type StatistiquesAutonomie,
} from "./index";

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurAutonomie);
    return (e as ErreurAutonomie).code;
  }
  return undefined;
};

const stats = (s: Partial<StatistiquesAutonomie> = {}): StatistiquesAutonomie => ({
  niveauActuel: "N2",
  niveauMaxBrique: "N3",
  executions: 50,
  accepteesSansModificationMajeure: 48,
  incidentsMajeursFenetre: 0,
  ...s,
});

describe("niveaux", () => {
  it("ordonne N0 à N4", () => {
    expect(rangNiveauAutonomie("N0")).toBe(0);
    expect(rangNiveauAutonomie("N4")).toBe(4);
    expect(estNiveauAutonomie("N3")).toBe(true);
    expect(estNiveauAutonomie("N5")).toBe(false);
  });
});

describe("niveauEffectif (AGT-03)", () => {
  it("prend le minimum du plafond et du niveau accordé", () => {
    expect(niveauEffectif("N3", "N2", "R2")).toEqual({ niveau: "N2", raisons: [] });
    expect(niveauEffectif("N2", "N3", "R1")).toEqual({ niveau: "N2", raisons: ["PLAFOND_BRIQUE"] });
  });

  it("réserve N4 à la classe R0", () => {
    expect(niveauEffectif("N4", "N4", "R0")).toEqual({ niveau: "N4", raisons: [] });
    expect(niveauEffectif("N4", "N4", "R1")).toEqual({ niveau: "N3", raisons: ["N4_RESERVE_R0"] });
  });

  it("applique le coupe-circuit du cabinet", () => {
    expect(niveauEffectif("N4", "N4", "R0", { coupeCircuitN4: true })).toEqual({
      niveau: "N3",
      raisons: ["COUPE_CIRCUIT_N4"],
    });
    expect(niveauEffectif("N3", "N3", "R2", { coupeCircuitN4: true }).niveau).toBe("N3");
  });

  it("refuse un niveau ou une classe inconnus", () => {
    expect(code(() => niveauEffectif("N9" as never, "N1", "R0"))).toBe("NIVEAU_INVALIDE");
    expect(code(() => niveauEffectif("N1", "X" as never, "R0"))).toBe("NIVEAU_INVALIDE");
    expect(code(() => niveauEffectif("N1", "N1", "R7" as never))).toBe("CLASSE_INVALIDE");
  });
});

describe("evaluerPromotion (N2 → N3)", () => {
  it("éligible à 50 exécutions, 96 % acceptées, sans incident ; décision d'un associé", () => {
    expect(evaluerPromotion(stats())).toEqual({
      eligible: true,
      niveauActuel: "N2",
      niveauPropose: "N3",
      raisons: [],
      decisionRequise: "associe",
      tauxAcceptation: 0.96,
    });
  });

  it("95 % exactement suffit ; en dessous non", () => {
    expect(
      evaluerPromotion(stats({ executions: 60, accepteesSansModificationMajeure: 57 })).eligible,
    ).toBe(true);
    const r = evaluerPromotion(stats({ executions: 60, accepteesSansModificationMajeure: 56 }));
    expect(r.raisons).toEqual(["TAUX_ACCEPTATION_INSUFFISANT"]);
    expect(r.niveauPropose).toBeNull();
  });

  it("liste toutes les raisons de refus, dans l'ordre", () => {
    const r = evaluerPromotion(
      stats({
        niveauActuel: "N1",
        niveauMaxBrique: "N2",
        executions: 0,
        accepteesSansModificationMajeure: 0,
        incidentsMajeursFenetre: 1,
      }),
    );
    expect(r.raisons).toEqual([
      "NIVEAU_NON_PROMOUVABLE",
      "PLAFOND_BRIQUE",
      "EXECUTIONS_INSUFFISANTES",
      "TAUX_ACCEPTATION_INSUFFISANT",
      "INCIDENT_MAJEUR_RECENT",
    ]);
    expect(r.tauxAcceptation).toBeNull();
  });

  it("accepte des seuils calibrés et les contrôle", () => {
    const s = { executionsMin: 10, tauxAcceptationMinPct: 90, fenetreIncidentsJours: 30 };
    expect(
      evaluerPromotion(stats({ executions: 10, accepteesSansModificationMajeure: 9 }), s).eligible,
    ).toBe(true);
    expect(code(() => evaluerPromotion(stats(), { ...s, tauxAcceptationMinPct: 101 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(code(() => evaluerPromotion(stats(), { ...s, fenetreIncidentsJours: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(code(() => evaluerPromotion(stats(), { ...s, executionsMin: -1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
  });

  it("refuse des statistiques incohérentes", () => {
    expect(code(() => evaluerPromotion(stats({ accepteesSansModificationMajeure: 51 })))).toBe(
      "STATISTIQUES_INVALIDES",
    );
    expect(code(() => evaluerPromotion(stats({ executions: 1.5 })))).toBe("STATISTIQUES_INVALIDES");
    expect(code(() => evaluerPromotion(stats({ incidentsMajeursFenetre: -1 })))).toBe(
      "STATISTIQUES_INVALIDES",
    );
    expect(code(() => evaluerPromotion(stats({ niveauActuel: "N7" as never })))).toBe(
      "NIVEAU_INVALIDE",
    );
  });
});

describe("statistiquesAutonomie", () => {
  const executions = [
    { date: "2026-09-01", acceptee: true, modificationMajeure: false },
    { date: "2026-09-02", acceptee: true, modificationMajeure: true },
    { date: "2026-09-03", acceptee: false, modificationMajeure: false },
    { date: "2026-09-04", acceptee: true, modificationMajeure: false },
  ];

  it("compte les acceptations et les incidents majeurs de la fenêtre de 90 jours", () => {
    const s = statistiquesAutonomie({
      niveauActuel: "N2",
      niveauMaxBrique: "N3",
      executions,
      incidents: [
        { date: "2026-07-10", gravite: "majeur" }, // 90 jours avant : hors fenêtre
        { date: "2026-07-11", gravite: "majeur" }, // 89 jours avant : dans la fenêtre
        { date: "2026-10-01", gravite: "mineur" },
        { date: "2026-10-09", gravite: "majeur" }, // après la référence : ignoré
      ],
      dateReference: "2026-10-08",
    });
    expect(s).toEqual({
      niveauActuel: "N2",
      niveauMaxBrique: "N3",
      executions: 4,
      accepteesSansModificationMajeure: 2,
      incidentsMajeursFenetre: 1,
    });
  });

  it("accepte une fenêtre calibrée et refuse dates, gravités et fenêtres invalides", () => {
    const base = {
      niveauActuel: "N2" as const,
      niveauMaxBrique: "N3" as const,
      executions: [],
      incidents: [{ date: "2026-10-01", gravite: "majeur" as const }],
      dateReference: "2026-10-08",
    };
    expect(
      statistiquesAutonomie({ ...base, fenetreIncidentsJours: 7 }).incidentsMajeursFenetre,
    ).toBe(0);
    expect(code(() => statistiquesAutonomie({ ...base, dateReference: "2026-02-30" }))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => statistiquesAutonomie({ ...base, dateReference: 20261008 as never }))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      code(() =>
        statistiquesAutonomie({
          ...base,
          executions: [{ date: "hier", acceptee: true, modificationMajeure: false }],
        }),
      ),
    ).toBe("DATE_INVALIDE");
    expect(
      code(() =>
        statistiquesAutonomie({
          ...base,
          incidents: [{ date: "2026-10-01", gravite: "grave" as never }],
        }),
      ),
    ).toBe("STATISTIQUES_INVALIDES");
    expect(code(() => statistiquesAutonomie({ ...base, fenetreIncidentsJours: 0 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(code(() => statistiquesAutonomie({ ...base, niveauMaxBrique: "?" as never }))).toBe(
      "NIVEAU_INVALIDE",
    );
  });
});

describe("retrogradationAuto", () => {
  it("un incident majeur ramène N3 et N4 à N2", () => {
    expect(retrogradationAuto({ niveauActuel: "N3", gravite: "majeur" })).toEqual({
      retrograde: true,
      niveauAvant: "N3",
      niveauApres: "N2",
      raison: "INCIDENT_MAJEUR",
    });
    expect(retrogradationAuto({ niveauActuel: "N4", gravite: "majeur" }).niveauApres).toBe("N2");
  });

  it("sans effet pour un incident mineur ou une brique déjà sous validation", () => {
    expect(retrogradationAuto({ niveauActuel: "N4", gravite: "mineur" })).toMatchObject({
      retrograde: false,
      niveauApres: "N4",
      raison: "INCIDENT_MINEUR",
    });
    expect(retrogradationAuto({ niveauActuel: "N2", gravite: "majeur" })).toMatchObject({
      retrograde: false,
      niveauApres: "N2",
      raison: "DEJA_SOUS_VALIDATION",
    });
  });

  it("refuse une entrée invalide", () => {
    expect(code(() => retrogradationAuto({ niveauActuel: "N3", gravite: "x" as never }))).toBe(
      "STATISTIQUES_INVALIDES",
    );
    expect(code(() => retrogradationAuto({ niveauActuel: "Z" as never, gravite: "majeur" }))).toBe(
      "NIVEAU_INVALIDE",
    );
  });
});

describe("API publique du domaine autonomie", () => {
  it("expose les moteurs", () => {
    for (const nom of [
      "ErreurAutonomie",
      "NIVEAUX_AUTONOMIE",
      "niveauEffectif",
      "statistiquesAutonomie",
      "evaluerPromotion",
      "retrogradationAuto",
    ]) {
      expect(autonomie).toHaveProperty(nom);
    }
  });
});
