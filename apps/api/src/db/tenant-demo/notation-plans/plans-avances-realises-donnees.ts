import type { SpecPlanVivant } from "./plans-avances-realises.js";

/*
 * Réalisés et re-prévisions semés (voir plans-avances-realises.ts pour la dérivation des montants).
 * SICAFÉ (plan 1, modèle v2 validé) : exercice 2025 complet (T4 corrigé après la clôture des comptes),
 * exercice 2026 jusqu'au troisième trimestre ; saisonnalité de la campagne cacao-café (parts du
 * trimestre en pour mille). Baobab Assurances (plan 6, modèle v1 validé) : réalisés partiels de 2026.
 */

export const PLAN_VIVANT_SICAFE: SpecPlanVivant = {
  version: 2,
  repartition: [280, 230, 220, 270],
  seuil: 80,
  exercices: [
    {
      exercice: 2025,
      facteursCa: [0.97, 0.94, 1.01, 0.99],
      facteursEbe: [0.82, 0.7, 0.95, 0.88],
      commentaires: [
        "Campagne principale conforme aux volumes attendus ; prix d'achat bord champ supérieurs au budget.",
        "Intersaison : volumes inférieurs au plan, arrêt de la ligne de séchage pour maintenance.",
        "Reprise des achats et rattrapage des expéditions vers l'Europe.",
        "Comptes provisoires du trimestre.",
      ],
      correction: {
        trimestre: 4,
        deltaCa: -0.006,
        deltaEbe: -0.02,
        commentaire:
          "Comptes du trimestre arrêtés après la clôture de l'exercice : régularisation de ristournes aux coopératives.",
      },
      reprevisions: [
        { apres: 2, methode: "reste_du_plan" },
        { apres: 3, methode: "reste_du_plan" },
        { apres: 4, methode: "reste_du_plan", explication: "modifie" },
      ],
    },
    {
      exercice: 2026,
      facteursCa: [1.03, 1.06, 1.04],
      facteursEbe: [1.08, 1.12, 1.05],
      commentaires: [
        "Campagne principale soutenue par les contrats avec les coopératives ; effet favorable des prix de vente.",
        "Montée en charge du bureau commercial de Rotterdam ; coûts de transport en baisse.",
        "Livraisons de fin de trimestre décalées par la saison des pluies ; marge préservée.",
      ],
      reprevisions: [
        { apres: 2, methode: "reste_du_plan" },
        { apres: 3, methode: "reste_du_plan", explication: "brouillon" },
        { apres: 3, methode: "tendance" },
      ],
    },
  ],
};

export const PLAN_VIVANT_BAOBAB: SpecPlanVivant = {
  version: 1,
  seuil: 100,
  exercices: [
    {
      exercice: 2026,
      facteursCa: [1.02, 0.99, 1.04],
      facteursEbe: [0.9, 1.05, 0.97],
      commentaires: [
        "Primes émises en légère hausse ; sinistralité automobile supérieure à la prévision.",
        null,
        "Renouvellements des contrats collectifs de fin de semestre ; charges de gestion maîtrisées.",
      ],
      reprevisions: [{ apres: 3, methode: "reste_du_plan", explication: "brouillon" }],
    },
  ],
};
