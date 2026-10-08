/**
 * Grille et questionnaire d'essai communs aux tests de notation (non exportés
 * par le paquet). Exemple chiffré à la main : voir `score.test.ts`.
 */
import type { DefinitionQuestionnaire } from "../questionnaires/types";
import type { GrilleNotation } from "./grille";

const LIKERT5 = ["Inexistant", "Ponctuel", "En place", "Systématique", "Exemplaire"];

export const GRILLE: GrilleNotation = {
  id: "essai",
  version: 1,
  titre: "Grille d'essai",
  dimensions: [
    {
      id: "strategie",
      libelle: "Stratégie",
      famille: "excellence",
      poids: 60,
      indicateurs: [
        { id: "i1", question: "q1", poids: 2, conversion: { type: "likert", points: 5 } },
        {
          id: "i2",
          question: "q2",
          poids: 1,
          conversion: {
            type: "choix",
            valeurs: [
              { code: "a", points: 100 },
              { code: "b", points: 50 },
              { code: "c", points: 0 },
            ],
          },
        },
        { id: "i3", question: "q3", poids: 1, conversion: { type: "oui_non", oui: 100, non: 0 } },
      ],
    },
    {
      id: "couts",
      libelle: "Coûts",
      famille: "competitivite",
      poids: 40,
      indicateurs: [
        {
          id: "i4",
          question: "q4",
          poids: 1,
          conversion: {
            type: "seuils",
            paliers: [
              { min: 0, points: 0 },
              { min: 10, points: 50 },
              { min: 20, points: 100 },
            ],
          },
        },
        {
          id: "i5",
          question: "q5",
          poids: 1,
          conversion: {
            type: "interpolation",
            points: [
              { x: 0, y: 100 },
              { x: 50, y: 0 },
            ],
          },
        },
        {
          id: "i6",
          question: "q6",
          poids: 2,
          conversion: { type: "likert", points: 5, inverse: true },
        },
      ],
    },
  ],
  secteurs: [
    { secteur: "industrie", libelle: "Industrie", poids: [{ dimension: "couts", poids: 60 }] },
    {
      secteur: "numerique",
      poids: [
        { dimension: "strategie", poids: 1 },
        { dimension: "couts", poids: 2 },
      ],
    },
  ],
};

export const QUESTIONNAIRE: DefinitionQuestionnaire = {
  id: "essai",
  version: 1,
  titre: "Questionnaire d'essai",
  sections: [
    {
      id: "strategie",
      titre: "Stratégie",
      questions: [
        { id: "q3", type: "oui_non", libelle: "Plan formalisé ?", obligatoire: true },
        {
          id: "q1",
          type: "likert",
          libelle: "Déploiement",
          obligatoire: true,
          points: 5,
          libelles: LIKERT5,
          condition: { op: "egal", question: "q3", valeur: true },
        },
        {
          id: "q2",
          type: "choix_unique",
          libelle: "Revue",
          obligatoire: false,
          options: [
            { code: "a", libelle: "Mensuelle" },
            { code: "b", libelle: "Annuelle" },
            { code: "c", libelle: "Jamais" },
          ],
        },
        { id: "note", type: "texte", libelle: "Remarque", obligatoire: false },
      ],
    },
    {
      id: "couts",
      titre: "Coûts",
      questions: [
        {
          id: "q4",
          type: "numerique",
          libelle: "Marge (%)",
          obligatoire: false,
          min: 0,
          max: 100,
          unite: "%",
        },
        {
          id: "q5",
          type: "numerique",
          libelle: "Rebuts (%)",
          obligatoire: false,
          min: 0,
          max: 100,
          unite: "%",
        },
        {
          id: "q6",
          type: "likert",
          libelle: "Gaspillage",
          obligatoire: false,
          points: 5,
          libelles: LIKERT5,
        },
      ],
    },
  ],
};

/** Réponses de l'exemple chiffré. */
export const REPONSES_EXEMPLE = { q1: 3, q2: "b", q3: true, q4: 15, q5: 20, q6: 2 } as const;

/** Générateur pseudo-aléatoire déterministe (LCG de Park-Miller) pour les tests de propriétés. */
export function generateur(graine: number): () => number {
  let etat = graine % 2_147_483_647;
  return () => {
    etat = (etat * 16_807) % 2_147_483_647;
    return (etat - 1) / 2_147_483_646;
  };
}

/** Réponses aléatoires (dont des absences) pour la grille d'essai. */
export function reponsesAleatoires(
  alea: () => number,
): Record<string, number | string | boolean | null> {
  const ou = <T>(v: T) => (alea() < 0.15 ? null : v);
  return {
    q1: ou(1 + Math.floor(alea() * 5)),
    q2: ou(["a", "b", "c"][Math.floor(alea() * 3)] as string),
    q3: ou(alea() < 0.5),
    q4: ou(Math.round(alea() * 1000) / 10),
    q5: ou(Math.round(alea() * 1000) / 10),
    q6: ou(1 + Math.floor(alea() * 5)),
  };
}
