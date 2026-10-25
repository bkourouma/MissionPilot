import type { PlanBriques } from "./donnees-cap-types.js";
import type { CleMissionCasting } from "./outils.js";

/*
 * Découpage minimal des missions terminées du casting, créé par les routes SEULEMENT si la mission
 * n'a aucune tâche (en production, la phase « missions » du lot 2a les crée). Les missions sans
 * méthode adaptée dans le référentiel (redressement, due diligence) n'ont pas de brique.
 */
export const PLANS_BRIQUES: Partial<Record<CleMissionCasting, PlanBriques>> = {
  planSicafe: {
    methode: "plan_strategique",
    phases: [
      {
        libelle: "Diagnostic et vision",
        taches: [
          {
            libelle: "Diagnostic stratégique du groupe",
            brique: "diagnostic_strategique",
            duree: 12,
          },
          { libelle: "Matrice SWOT validée en comité", brique: "swot", duree: 4 },
          { libelle: "Vision et mission du groupe", brique: "vision_mission", duree: 3 },
        ],
      },
      {
        libelle: "Construction du plan",
        taches: [
          { libelle: "Axes stratégiques et objectifs", brique: "axes_objectifs", duree: 6 },
          { libelle: "Portefeuille d'initiatives", brique: "portefeuille_initiatives", duree: 10 },
          { libelle: "Feuille de route recalée", brique: "feuille_de_route", duree: 5 },
        ],
      },
      {
        libelle: "Restitution",
        taches: [
          { libelle: "Restitution du plan au conseil", brique: "restitution_plan", duree: 3 },
        ],
      },
    ],
  },
  notationSahel: {
    methode: "notation_entreprise",
    phases: [
      {
        libelle: "Cadrage et collecte",
        taches: [
          { libelle: "Cadrage de la notation", brique: "cadrage_mission", duree: 3 },
          {
            libelle: "Questionnaire préliminaire des dirigeants",
            brique: "questionnaire_preliminaire",
            duree: 4,
          },
          { libelle: "Entretiens individuels", brique: "entretiens_individuels", duree: 8 },
        ],
      },
      {
        libelle: "Analyse et notation",
        taches: [
          {
            libelle: "Analyse financière des trois derniers exercices",
            brique: "analyse_financiere",
            duree: 9,
          },
          { libelle: "Calcul de la note", brique: "calcul_note", duree: 4 },
          { libelle: "Rapport de notation", brique: "rapport_notation", duree: 6 },
        ],
      },
      {
        libelle: "Restitution",
        taches: [
          { libelle: "Restitution aux dirigeants", brique: "restitution_dirigeants", duree: 2 },
        ],
      },
    ],
  },
  businessPlanAtlantique: {
    methode: "business_plan_bancable",
    phases: [
      {
        libelle: "Cadrage et historique",
        taches: [
          { libelle: "Cadrage du projet d'expansion", brique: "cadrage_projet", duree: 3 },
          { libelle: "Analyse financière historique", brique: "analyse_historique", duree: 8 },
        ],
      },
      {
        libelle: "Modèle financier",
        taches: [
          { libelle: "Hypothèses du modèle", brique: "hypotheses", duree: 6 },
          { libelle: "Calcul du modèle financier", brique: "calcul_modele", duree: 7 },
          { libelle: "Plan de financement", brique: "plan_financement", duree: 5 },
        ],
      },
      {
        libelle: "Dossier bancaire",
        taches: [
          { libelle: "Dossier de présentation aux banques", brique: "dossier_bancaire", duree: 6 },
          { libelle: "Restitution au dirigeant", brique: "restitution_dirigeant", duree: 2 },
        ],
      },
    ],
  },
};
