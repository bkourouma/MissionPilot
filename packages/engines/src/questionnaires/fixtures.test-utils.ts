/**
 * Questionnaire d'essai commun aux tests du moteur (non exporté par le paquet).
 */
import type { DefinitionQuestionnaire } from "./types";

export const LIKERT5 = ["Jamais", "Rarement", "Parfois", "Souvent", "Toujours"] as const;

export const DEF: DefinitionQuestionnaire = {
  id: "essai",
  version: 1,
  titre: "Questionnaire d'essai",
  sections: [
    {
      id: "general",
      titre: "Général",
      questions: [
        { id: "plan", type: "oui_non", libelle: "Avez-vous un plan ?", obligatoire: true },
        {
          id: "horizon",
          type: "choix_unique",
          libelle: "Horizon du plan",
          obligatoire: true,
          options: [
            { code: "un_an", libelle: "1 an" },
            { code: "trois_ans", libelle: "3 ans" },
            { code: "cinq_ans", libelle: "5 ans" },
          ],
          condition: { op: "egal", question: "plan", valeur: true },
        },
        {
          id: "revue",
          type: "likert",
          libelle: "Le plan est-il revu ?",
          obligatoire: true,
          points: 5,
          libelles: LIKERT5,
          condition: { op: "dans", question: "horizon", valeurs: ["trois_ans", "cinq_ans"] },
        },
        {
          id: "commentaire",
          type: "texte",
          libelle: "Commentaire",
          obligatoire: false,
          longueurMax: 10,
        },
      ],
    },
    {
      id: "chiffres",
      titre: "Chiffres",
      condition: { op: "non", condition: { op: "vide", question: "plan" } },
      questions: [
        {
          id: "effectif",
          type: "numerique",
          libelle: "Effectif",
          obligatoire: true,
          min: 0,
          max: 1000,
          entier: true,
          unite: "personnes",
        },
        {
          id: "outils",
          type: "choix_multiple",
          libelle: "Outils",
          obligatoire: false,
          options: [
            { code: "erp", libelle: "ERP" },
            { code: "crm", libelle: "CRM" },
            { code: "bi", libelle: "Décisionnel" },
          ],
          maxSelections: 2,
          condition: { op: "superieur", question: "effectif", valeur: 10 },
        },
        {
          id: "creation",
          type: "date",
          libelle: "Date de création",
          obligatoire: false,
          min: "1950-01-01",
          max: "2026-12-31",
          condition: {
            op: "ou",
            conditions: [
              { op: "inferieur", question: "effectif", valeur: 50 },
              { op: "different", question: "plan", valeur: true },
            ],
          },
        },
      ],
    },
  ],
};

/** Copie modifiable profonde (pour fabriquer des définitions fautives). */
export function copie<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
