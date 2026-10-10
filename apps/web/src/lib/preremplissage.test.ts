import { describe, expect, it } from "vitest";
import {
  appliquerPropositions,
  clePropositionTemps,
  selectionParDefaut,
  type PropositionTemps,
} from "./preremplissage";
import type { Rangee } from "./temps";

const p = (surcharge: Partial<PropositionTemps> = {}): PropositionTemps => ({
  date: "2026-11-02",
  mission_id: "m1",
  tache_id: "t1",
  mission_intitule: "Audit",
  tache_libelle: "Diagnostic",
  jours: 1,
  heures: 8,
  source: "affectation",
  confiance: "moyenne",
  raisons: [],
  ...surcharge,
});

const rangee: Rangee = {
  cle: "t:t1",
  type: "tache",
  id: "t1",
  libelle: "Diagnostic",
  groupe: "Audit",
  mission_id: "m1",
};

describe("sélection par défaut", () => {
  it("coche tout sauf les propositions de confiance faible", () => {
    const liste = [
      p(),
      p({ date: "2026-11-03", confiance: "haute" }),
      p({ date: "2026-11-04", confiance: "faible" }),
    ];
    const s = selectionParDefaut(liste);
    expect([...s]).toEqual(["2026-11-02|t1", "2026-11-03|t1"]);
    expect(clePropositionTemps(liste[2] as PropositionTemps)).toBe("2026-11-04|t1");
  });
});

describe("application à la grille", () => {
  it("remplit les cases vides en jours, avec la virgule décimale", () => {
    const r = appliquerPropositions(
      { rangees: [rangee], valeurs: {} },
      [p(), p({ date: "2026-11-03", jours: 0.5 })],
      "demi_journee",
    );
    expect(r.valeurs).toEqual({ "t:t1|2026-11-02": "1", "t:t1|2026-11-03": "0,5" });
    expect(r.appliquees).toBe(2);
    expect(r.conservees).toBe(0);
    expect(r.rangees).toHaveLength(1);
  });

  it("écrit des heures quand le cabinet saisit à l'heure", () => {
    const r = appliquerPropositions(
      { rangees: [rangee], valeurs: {} },
      [p({ heures: 7.5 })],
      "heure",
    );
    expect(r.valeurs["t:t1|2026-11-02"]).toBe("7,5");
  });

  it("n'écrase jamais une case déjà remplie", () => {
    const r = appliquerPropositions(
      { rangees: [rangee], valeurs: { "t:t1|2026-11-02": "0,5" } },
      [p()],
      "demi_journee",
    );
    expect(r.valeurs["t:t1|2026-11-02"]).toBe("0,5");
    expect(r.appliquees).toBe(0);
    expect(r.conservees).toBe(1);
  });

  it("ajoute la rangée d'une tâche absente de la grille", () => {
    const r = appliquerPropositions(
      { rangees: [], valeurs: {} },
      [p({ tache_id: "t9", tache_libelle: null, mission_intitule: null })],
      "demi_journee",
    );
    expect(r.rangees).toEqual([
      {
        cle: "t:t9",
        type: "tache",
        id: "t9",
        libelle: "Tâche",
        groupe: "Mission",
        mission_id: "m1",
      },
    ]);
    expect(r.valeurs["t:t9|2026-11-02"]).toBe("1");
  });

  it("ne modifie pas l'état reçu", () => {
    const etat = { rangees: [rangee], valeurs: {} as Record<string, string> };
    appliquerPropositions(etat, [p()], "demi_journee");
    expect(etat.valeurs).toEqual({});
    expect(etat.rangees).toHaveLength(1);
  });
});
