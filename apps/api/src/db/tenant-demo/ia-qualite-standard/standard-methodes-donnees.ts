import type { Ajouts, DefBrique } from "./standard-aide.js";

/*
 * Contenu des méthodes du cabinet « Tenant démo » (textes en français, jugement d'expert : aucun
 * chiffre calculé ici ; les « jours types » sont des ordres de grandeur de planification saisis
 * par le consultant, jamais produits par un modèle de langage).
 */

export interface DefMethodeCabinet {
  code: string;
  libelle: string;
  description: string;
  service: string;
  contenu: Ajouts;
}

export const b = (
  etape: string,
  code: string,
  libelle: string,
  objet: string,
  classe: DefBrique["classe"],
  autonomie: DefBrique["autonomie"],
  extra: Partial<DefBrique> = {},
): DefBrique => ({ etape, code, libelle, objet, classe, autonomie, active: true, ...extra });

export const METHODE_DD: DefMethodeCabinet = {
  code: "due_diligence_cabinet",
  libelle: "Due diligence acquéreur — démarche du cabinet",
  description:
    "Démarche par hypothèses du cabinet pour les acquisitions de PME africaines : chaque hypothèse reçoit un verdict sourcé, jamais un chiffre issu d'un modèle de langage.",
  service: "due_diligence",
  contenu: {
    etapes: [
      {
        code: "cadrage_dd",
        libelle: "Cadrage",
        description: "Périmètre, hypothèses et accès à la salle de données.",
      },
      {
        code: "collecte_dd",
        libelle: "Collecte",
        description: "Salle de données, entretiens et pièces.",
      },
      {
        code: "analyse_dd",
        libelle: "Analyse",
        description: "Vérification des hypothèses et des preuves.",
      },
      {
        code: "restitution_dd",
        libelle: "Restitution",
        description: "Rapport et présentation à l'investisseur.",
      },
    ],
    briques: [
      b(
        "cadrage_dd",
        "cadrage_hypotheses",
        "Formulation des hypothèses",
        "Traduire la thèse d'investissement en hypothèses vérifiables.",
        "R2",
        "N1",
        {
          jours: 1,
          profil: "Directeur de mission",
          sortie: "Liste d'hypothèses validée avec l'investisseur",
        },
      ),
      b(
        "cadrage_dd",
        "lettre_engagement_dd",
        "Lettre d'engagement",
        "Cadrer le périmètre, la confidentialité et les limites de responsabilité.",
        "R1",
        "N2",
        { jours: 0.25, profil: "Chef de mission" },
      ),
      b(
        "collecte_dd",
        "revue_data_room",
        "Revue de la salle de données",
        "Classer les pièces reçues et signaler les pièces manquantes.",
        "R1",
        "N2",
        {
          agent: "documentaire",
          jours: 1.5,
          profil: "Consultant",
          garde: "Contrôle humain du classement avant analyse",
        },
      ),
      b(
        "collecte_dd",
        "entretiens_direction",
        "Entretiens de la direction",
        "Recueillir la version de la direction sur les hypothèses sensibles.",
        "R1",
        "N1",
        { jours: 1, profil: "Consultant senior" },
      ),
      b(
        "analyse_dd",
        "analyse_financiere_dd",
        "Analyse financière de la cible",
        "Lire les comptes historiques et la qualité des résultats.",
        "R2",
        "N2",
        {
          agent: "analyste",
          jours: 2.5,
          profil: "Consultant senior",
          garde: "Validation du consultant senior ; l'IA propose, l'expert dispose",
        },
      ),
      b(
        "analyse_dd",
        "verification_preuves",
        "Vérification des preuves",
        "Rattacher chaque constat à une preuve et mesurer sa solidité.",
        "R2",
        "N1",
        { moteur: "preuves.solidite", jours: 1.5, profil: "Consultant senior" },
      ),
      b(
        "analyse_dd",
        "verdict_hypotheses",
        "Verdict par hypothèse",
        "Conclure sur chaque hypothèse : confirmée, nuancée ou infirmée.",
        "R3",
        "N1",
        {
          jours: 1,
          profil: "Directeur de mission",
          garde: "Revue d'un second expert avant diffusion",
        },
      ),
      b(
        "analyse_dd",
        "visite_site",
        "Visite du site d'exploitation",
        "Constater sur place l'outil de production ou l'activité.",
        "R1",
        "N1",
        { active: false, jours: 1, profil: "Consultant senior" },
      ),
      b(
        "restitution_dd",
        "rapport_dd",
        "Rapport de due diligence",
        "Rédiger le rapport sourcé, avec la mention de la contribution IA.",
        "R3",
        "N2",
        {
          agent: "redacteur",
          jours: 2,
          profil: "Chef de mission",
          garde: "Validation d'un expert avant toute remise au client",
        },
      ),
      b(
        "restitution_dd",
        "restitution_investisseur",
        "Restitution à l'investisseur",
        "Présenter les verdicts et les points de négociation.",
        "R2",
        "N1",
        { jours: 0.5, profil: "Directeur de mission" },
      ),
    ],
    elements: [
      {
        type: "livrable",
        code: "rapport_dd_livrable",
        libelle: "Rapport de due diligence",
        brique: "rapport_dd",
        essentiel: true,
      },
      {
        type: "livrable",
        code: "tableau_verdicts",
        libelle: "Tableau des verdicts par hypothèse",
        brique: "verdict_hypotheses",
        essentiel: true,
      },
      {
        type: "gabarit",
        code: "index_data_room",
        libelle: "Index de la salle de données",
        brique: "revue_data_room",
      },
      {
        type: "item",
        code: "passif_social",
        libelle: "Passif social et arriérés de cotisations",
        brique: "analyse_financiere_dd",
      },
      {
        type: "item",
        code: "creances_publiques",
        libelle: "Créances sur l'État et délais de paiement",
        brique: "analyse_financiere_dd",
      },
      {
        type: "risque_type",
        code: "dependance_client_cle",
        libelle: "Dépendance à un client clé",
        brique: "verdict_hypotheses",
      },
    ],
    regles: [
      {
        code: "situation_tendue_visite",
        libelle: "Cible en tension : visite du site",
        priorite: 10,
        condition: {
          type: "comparaison",
          facteur: "situation",
          comparateur: "dans",
          valeur: ["tension", "difficulte"],
        },
        effets: [{ type: "activer_brique", brique: "visite_site" }],
      },
    ],
  },
};

export const METHODE_REDRESSEMENT: DefMethodeCabinet = {
  code: "redressement_cabinet",
  libelle: "Redressement — démarche du cabinet",
  description:
    "De l'alerte au bilan de clôture : pré-diagnostic, plan de redressement validé par le directeur de mission et suivi de trésorerie hebdomadaire.",
  service: "redressement",
  contenu: {
    etapes: [
      {
        code: "alerte",
        libelle: "Alerte et pré-diagnostic",
        description: "Signaux d'urgence et premiers constats.",
      },
      {
        code: "diagnostic_rd",
        libelle: "Diagnostic",
        description: "Causes et marges de manœuvre.",
      },
      {
        code: "plan_rd",
        libelle: "Plan de redressement",
        description: "Mesures, calendrier et négociations.",
      },
      {
        code: "suivi_rd",
        libelle: "Suivi et clôture",
        description: "Suivi de trésorerie et bilan.",
      },
    ],
    briques: [
      b(
        "alerte",
        "signaux_alerte",
        "Signaux d'alerte",
        "Relever les signaux d'urgence (trésorerie, impayés, incidents bancaires).",
        "R2",
        "N1",
        { jours: 0.5, profil: "Chef de mission" },
      ),
      b(
        "diagnostic_rd",
        "diagnostic_causes",
        "Diagnostic des causes",
        "Distinguer causes structurelles et conjoncturelles.",
        "R2",
        "N2",
        { agent: "analyste", jours: 2, profil: "Consultant senior" },
      ),
      b(
        "diagnostic_rd",
        "revue_tresorerie_13s",
        "Revue de la trésorerie à 13 semaines",
        "Reconstituer les flux de trésorerie par un moteur de calcul testé.",
        "R2",
        "N1",
        { moteur: "plan.modele_financier", jours: 1.5, profil: "Consultant senior" },
      ),
      b(
        "plan_rd",
        "plan_redressement",
        "Plan de redressement",
        "Arrêter les mesures et leur calendrier ; validation par le directeur de mission.",
        "R3",
        "N1",
        {
          jours: 3,
          profil: "Directeur de mission",
          garde: "Validation réservée au directeur de la mission",
        },
      ),
      b(
        "plan_rd",
        "negociation_creanciers",
        "Négociation avec les créanciers",
        "Préparer l'argumentaire pour les banques et fournisseurs.",
        "R3",
        "N0",
        { jours: 2, profil: "Directeur de mission" },
      ),
      b(
        "plan_rd",
        "communication_banques",
        "Communication aux banques",
        "Note d'information aux banquiers de l'entreprise.",
        "R2",
        "N1",
        { active: false, jours: 0.5, profil: "Chef de mission" },
      ),
      b(
        "suivi_rd",
        "suivi_tresorerie_hebdo",
        "Suivi hebdomadaire de la trésorerie",
        "Comparer le réalisé au plan et relever les écarts.",
        "R2",
        "N2",
        { agent: "analyste", jours: 0.5, profil: "Consultant" },
      ),
      b(
        "suivi_rd",
        "bilan_cloture_rd",
        "Bilan de clôture",
        "Bilan de la mission ; validation réservée au directeur de la mission.",
        "R3",
        "N1",
        { jours: 1, profil: "Directeur de mission" },
      ),
    ],
    elements: [
      {
        type: "livrable",
        code: "plan_redressement_livrable",
        libelle: "Plan de redressement",
        brique: "plan_redressement",
        essentiel: true,
      },
      {
        type: "livrable",
        code: "bilan_cloture_livrable",
        libelle: "Bilan de clôture",
        brique: "bilan_cloture_rd",
        essentiel: true,
      },
      {
        type: "kpi_type",
        code: "tresorerie_nette_hebdo",
        libelle: "Trésorerie nette hebdomadaire",
        brique: "suivi_tresorerie_hebdo",
      },
      {
        type: "risque_type",
        code: "rupture_ligne_credit",
        libelle: "Rupture d'une ligne de crédit",
        brique: "negociation_creanciers",
      },
    ],
    regles: [
      {
        code: "banques_a_informer",
        libelle: "Entreprise en difficulté : informer les banques",
        priorite: 10,
        condition: {
          type: "comparaison",
          facteur: "situation",
          comparateur: "egal",
          valeur: "difficulte",
        },
        effets: [{ type: "activer_brique", brique: "communication_banques" }],
      },
    ],
  },
};
