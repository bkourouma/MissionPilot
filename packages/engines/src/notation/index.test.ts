import { describe, expect, it } from "vitest";
import * as racine from "../index";
import * as notation from "./index";
import * as questionnaires from "../questionnaires/index";

describe("API publique des moteurs V2", () => {
  it("expose les moteurs de questionnaires et de notation, aussi depuis la racine du paquet", () => {
    const questionnaire = [
      "ErreurQuestionnaire",
      "validerDefinition",
      "questionsVisibles",
      "validerReponse",
      "validerReponses",
      "progression",
      "validerRepondants",
      "creerReponseCollective",
      "fusionnerReponses",
      "soumettreReponses",
      "detecterEcarts",
    ];
    const notes = [
      "ErreurNotation",
      "validerGrille",
      "poidsNormalises",
      "verifierCoherence",
      "classe",
      "scoreQuestion",
      "scoreDimension",
      "scoreGlobal",
      "noterRepondants",
      "noterQuestionnaire",
      "appliquerAjustement",
      "comparerNotations",
      "forcesEtFaiblesses",
      "donneesRapport",
    ];
    questionnaire.forEach((nom) => {
      expect(questionnaires).toHaveProperty(nom);
      expect(racine).toHaveProperty(nom);
    });
    notes.forEach((nom) => {
      expect(notation).toHaveProperty(nom);
      expect(racine).toHaveProperty(nom);
    });
  });
});
