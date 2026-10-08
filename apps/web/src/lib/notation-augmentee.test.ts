import { describe, expect, it } from "vitest";
import {
  CAPACITE_DEFAUT,
  cheminBanque,
  cheminCalibrations,
  cheminConfiance,
  cheminExplication,
  cheminPropositionPlan,
  formaterPointsSignes,
  formaterRatio,
  hrefAnalyseNotation,
  lireCapacite,
  lireCible,
  lireStatutBanque,
  phraseSimulation,
  validerCapacite,
  type SimulationPassage,
} from "./notation-augmentee";

describe("notation augmentée : chemins et paramètres", () => {
  it("construit les chemins de l'API et de la page d'analyse", () => {
    expect(cheminConfiance("n/1", 2)).toBe("/api/notations/n%2F1/confiance?version=2");
    expect(cheminExplication("n", 1, null)).toBe("/api/notations/n/explication?version=1");
    expect(cheminExplication("n", 1, "B")).toBe("/api/notations/n/explication?version=1&cible=B");
    expect(cheminPropositionPlan("n", 3, 4)).toBe(
      "/api/notations/n/plan-action/proposition?version=3&capacite=4",
    );
    expect(cheminBanque("", null)).toBe("/api/notation/banque?limite=50");
    expect(cheminBanque("abc", "valide")).toBe(
      "/api/notation/banque?limite=50&curseur=abc&statut=valide",
    );
    expect(cheminCalibrations("")).toBe("/api/notation/calibrations?limite=50");
    expect(cheminCalibrations("a b")).toBe("/api/notation/calibrations?limite=50&curseur=a%20b");
    expect(hrefAnalyseNotation("m")).toBe("/missions/m/notation/analyse");
    expect(hrefAnalyseNotation("m", 2)).toBe("/missions/m/notation/analyse?version=2");
  });

  it("lit la classe visée, la capacité et le statut de filtre sans faire confiance à l'URL", () => {
    expect(lireCible("B")).toBe("B");
    expect(lireCible(["A", "B"])).toBe("A");
    expect(lireCible("E")).toBeNull();
    expect(lireCible(undefined)).toBeNull();
    expect(lireCapacite("4")).toBe(4);
    expect(lireCapacite("0")).toBe(CAPACITE_DEFAUT);
    expect(lireCapacite("2.5")).toBe(CAPACITE_DEFAUT);
    expect(lireStatutBanque("valide")).toBe("valide");
    expect(lireStatutBanque("autre")).toBeNull();
  });

  it("valide la capacité saisie", () => {
    expect(validerCapacite(" 12 ")).toEqual({ ok: true, charge: { capacite: 12 } });
    expect(validerCapacite("").ok).toBe(false);
    expect(validerCapacite("101").ok).toBe(false);
  });
});

describe("notation augmentée : présentation", () => {
  it("formate ratios et points signés", () => {
    expect(formaterRatio(0.8125)).toBe("81 %");
    expect(formaterRatio(null)).toBe("—");
    expect(formaterPointsSignes(3.5)).toMatch(/^\+3,50$/);
    expect(formaterPointsSignes(-1.2)).toMatch(/^−1,20$/);
    expect(formaterPointsSignes(0)).toMatch(/^0,00$/);
    // Arrondi d'abord, signe ensuite : jamais « −0,00 » ni « +0,00 ».
    expect(formaterPointsSignes(-0.004)).toMatch(/^0,00$/);
    expect(formaterPointsSignes(0.004)).toMatch(/^0,00$/);
    expect(formaterPointsSignes(-0.005)).toMatch(/^−0,01$/);
    expect(formaterPointsSignes(-0)).toMatch(/^0,00$/);
  });

  it("résume la simulation", () => {
    const base: SimulationPassage = {
      classe_actuelle: "C",
      score_actuel: 63.5,
      cible: "B",
      seuil: 65,
      deja_atteinte: false,
      atteignable: true,
      gain_necessaire: 1.5,
      score_projete: 71,
      classe_projetee: "B",
      etapes: [
        {
          dimension: "d",
          libelle: "D",
          indicateur: "i",
          question: "q",
          points_avant: 50,
          points_apres: 75,
          paliers: 1,
          gain: 7.5,
        },
      ],
    };
    expect(phraseSimulation(base)).toBe(
      "Pour passer de C à B (seuil 65), relever 1 pratique : score projeté 71 (classe B).",
    );
    expect(phraseSimulation({ ...base, etapes: [base.etapes[0]!, base.etapes[0]!] })).toContain(
      "2 pratiques",
    );
    expect(phraseSimulation({ ...base, deja_atteinte: true })).toBe(
      "La classe B est déjà atteinte.",
    );
    expect(
      phraseSimulation({ ...base, atteignable: false, tronquee: true, score_projete: 63.5 }),
    ).toContain("interrompue");
    expect(phraseSimulation({ ...base, atteignable: false, score_projete: 63.5 })).toContain(
      "n'est pas atteignable",
    );
  });
});
