import { describe, expect, it } from "vitest";
import { proposerSaisieSemaine, type EntreePreRemplissage } from "./preremplissage";

const SEMAINE = { debut: "2026-11-02", fin: "2026-11-08" };
const CAPACITE = {
  "2026-11-02": 1,
  "2026-11-03": 1,
  "2026-11-04": 1,
  "2026-11-05": 1,
  "2026-11-06": 1,
};

function entree(surcharge: Partial<EntreePreRemplissage> = {}): EntreePreRemplissage {
  return {
    semaine: SEMAINE,
    granularite: "demi_journee",
    heuresParJour: 8,
    planifie: [],
    activite: [],
    tachesAffectees: [
      { missionId: "m1", tacheId: "t1" },
      { missionId: "m1", tacheId: "t2" },
      { missionId: "m2", tacheId: "t3" },
    ],
    saisies: [],
    capaciteParJour: CAPACITE,
    joursVerrouilles: [],
    ...surcharge,
  };
}

describe("pré-remplissage des temps (AUT-09)", () => {
  it("propose les jours planifiés avec une confiance moyenne", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 1 },
          { date: "2026-11-03", missionId: "m1", tacheId: "t1", jours: 0.5 },
        ],
      }),
    );
    expect(r.propositions).toHaveLength(2);
    expect(r.propositions[0]).toMatchObject({
      date: "2026-11-02",
      tacheId: "t1",
      jours: 1,
      source: "affectation",
      confiance: "moyenne",
    });
    expect(r.totalJours).toBe(1.5);
    expect(r.ecartees).toEqual([]);
  });

  it("confirme une ligne planifiée par l'activité (confiance haute)", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [{ date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 1 }],
        activite: [{ date: "2026-11-02", missionId: "m1", tacheId: "t1", evenements: 3 }],
      }),
    );
    expect(r.propositions[0]).toMatchObject({
      source: "affectation_et_activite",
      confiance: "haute",
    });
    expect(r.propositions[0]?.raisons).toHaveLength(2);
  });

  it("propose une demi-journée pour une activité sur une tâche affectée non planifiée ce jour", () => {
    const r = proposerSaisieSemaine(
      entree({ activite: [{ date: "2026-11-04", missionId: "m2", tacheId: "t3", evenements: 1 }] }),
    );
    expect(r.propositions).toEqual([
      expect.objectContaining({
        tacheId: "t3",
        missionId: "m2",
        jours: 0.5,
        source: "activite",
        confiance: "faible",
      }),
    ]);
  });

  it("rattache une activité de mission à la tâche déjà planifiée, sinon à la première affectée", () => {
    const planifiee = proposerSaisieSemaine(
      entree({
        planifie: [{ date: "2026-11-02", missionId: "m1", tacheId: "t2", jours: 0.5 }],
        activite: [{ date: "2026-11-02", missionId: "m1", tacheId: null, evenements: 2 }],
      }),
    );
    expect(planifiee.propositions).toHaveLength(1);
    expect(planifiee.propositions[0]).toMatchObject({ tacheId: "t2", confiance: "haute" });
    const sans = proposerSaisieSemaine(
      entree({ activite: [{ date: "2026-11-03", missionId: "m1", tacheId: null, evenements: 1 }] }),
    );
    expect(sans.propositions[0]).toMatchObject({ tacheId: "t1", confiance: "faible" });
  });

  it("n'invente rien sur une tâche non affectée", () => {
    const r = proposerSaisieSemaine(
      entree({
        activite: [
          { date: "2026-11-02", missionId: "m9", tacheId: "t9", evenements: 4 },
          { date: "2026-11-03", missionId: "m9", tacheId: null, evenements: 1 },
          { date: "2026-11-04", missionId: "m1", tacheId: "t1", evenements: 0 },
        ],
      }),
    );
    expect(r.propositions).toEqual([]);
    expect(r.ecartees.map((e) => e.motif)).toEqual(["tache_non_affectee", "tache_non_affectee"]);
  });

  it("n'écrase pas une ligne déjà saisie et tient compte du temps déjà saisi", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 1 },
          { date: "2026-11-03", missionId: "m1", tacheId: "t2", jours: 1 },
        ],
        saisies: [
          { date: "2026-11-02", tacheId: "t1", jours: 0.5 },
          { date: "2026-11-03", tacheId: null, jours: 0.5 },
        ],
      }),
    );
    expect(r.ecartees).toEqual([
      expect.objectContaining({ date: "2026-11-02", tacheId: "t1", motif: "deja_saisi" }),
    ]);
    // Le 3, une activité interne occupe déjà une demi-journée : 0,5 j restent.
    expect(r.propositions).toEqual([
      expect.objectContaining({ date: "2026-11-03", tacheId: "t2", jours: 0.5 }),
    ]);
    expect(r.propositions[0]?.raisons).toContain("Réduit pour respecter la capacité du jour.");
  });

  it("respecte la capacité du jour : d'abord les lignes confirmées, puis les plus longues", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 1 },
          { date: "2026-11-02", missionId: "m1", tacheId: "t2", jours: 0.5 },
          { date: "2026-11-02", missionId: "m2", tacheId: "t3", jours: 0.5 },
        ],
        activite: [{ date: "2026-11-02", missionId: "m2", tacheId: "t3", evenements: 1 }],
      }),
    );
    // t3 (confirmée) 0,5 ; puis t1 (1) réduite à 0,5 ; t2 écartée.
    expect(r.propositions.map((p) => [p.tacheId, p.jours])).toEqual([
      ["t1", 0.5],
      ["t3", 0.5],
    ]);
    expect(r.ecartees).toEqual([
      expect.objectContaining({ tacheId: "t2", motif: "capacite_atteinte" }),
    ]);
  });

  it("n'écrit ni sur un jour verrouillé ni sur un jour non travaillé", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 1 },
          { date: "2026-11-07", missionId: "m1", tacheId: "t1", jours: 1 },
        ],
        joursVerrouilles: ["2026-11-02"],
      }),
    );
    expect(r.propositions).toEqual([]);
    expect(r.ecartees.map((e) => e.motif)).toEqual(["jour_verrouille", "jour_non_travaille"]);
  });

  it("additionne deux planifiés de la même tâche le même jour et ignore un planifié nul", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 0.5 },
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 0.5 },
          { date: "2026-11-02", missionId: "m1", tacheId: "t2", jours: 0 },
        ],
      }),
    );
    expect(r.propositions).toHaveLength(1);
    expect(r.propositions[0]?.jours).toBe(1);
  });

  it("travaille au centième de jour en saisie à l'heure", () => {
    const r = proposerSaisieSemaine(
      entree({
        granularite: "heure",
        planifie: [{ date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 0.63 }],
        saisies: [{ date: "2026-11-02", tacheId: null, jours: 0.5 }],
      }),
    );
    expect(r.propositions[0]?.jours).toBe(0.5);
    const activite = proposerSaisieSemaine(
      entree({
        granularite: "heure",
        activite: [{ date: "2026-11-03", missionId: "m1", tacheId: "t1", evenements: 1 }],
      }),
    );
    expect(activite.propositions[0]?.jours).toBe(0.5);
  });

  it("trie les propositions par date puis par tâche", () => {
    const r = proposerSaisieSemaine(
      entree({
        planifie: [
          { date: "2026-11-04", missionId: "m1", tacheId: "t2", jours: 0.5 },
          { date: "2026-11-02", missionId: "m2", tacheId: "t3", jours: 0.5 },
          { date: "2026-11-02", missionId: "m1", tacheId: "t1", jours: 0.5 },
        ],
      }),
    );
    expect(r.propositions.map((p) => `${p.date}|${p.tacheId}`)).toEqual([
      "2026-11-02|t1",
      "2026-11-02|t3",
      "2026-11-04|t2",
    ]);
  });
});
