import type { CleCompte } from "../cles.js";
import type { CleMissionCasting } from "./outils.js";

/*
 * Recommandations issues des retours d'expérience, KPI suivis et mesures d'entrée (CAP-03).
 * Seules les MESURES DE KPI sont des entrées saisies ; les scores d'efficacité sortent du moteur
 * (route `mesurer`). Seuil de 5 observations : cinq recommandations « Tableau de bord de pilotage »
 * mises en oeuvre et évaluées franchissent le seuil ; les autres types restent sous le seuil.
 */

export interface KpiRecommandation {
  libelle: string;
  unite: string;
  sens: "plus_haut_mieux" | "plus_bas_mieux";
  debut: string;
  cible: number;
}

export interface RecommandationDemo {
  mission: CleMissionCasting;
  auteur: CleCompte;
  libelle: string;
  type: string;
  kpi: KpiRecommandation;
  statut: "recommandee" | "mise_en_oeuvre" | "abandonnee";
  miseEnOeuvre?: string;
  motifAbandon?: string;
  /** Mesures du KPI (date, valeur) saisies par le chef de mission. */
  mesures: [string, number][];
}

const TDB = "Tableau de bord de pilotage";
const DETTE = "Renégociation de la dette bancaire";

export const RECOMMANDATIONS: RecommandationDemo[] = [
  {
    mission: "planSicafe",
    auteur: "chef.mission",
    libelle: "Instaurer un tableau de bord mensuel de pilotage de la transformation",
    type: TDB,
    kpi: {
      libelle: "Rendement matière de la transformation",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2024-11-18",
      cible: 80,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2025-01-20",
    mesures: [
      ["2024-12-16", 71],
      ["2025-01-17", 71.4],
      ["2025-03-17", 74.8],
      ["2025-04-14", 76.5],
    ],
  },
  {
    mission: "notationSahel",
    auteur: "chef.mission",
    libelle: "Mettre en place un tableau de bord de suivi des créances clients",
    type: TDB,
    kpi: {
      libelle: "Délai moyen de paiement des clients",
      unite: "jours",
      sens: "plus_bas_mieux",
      debut: "2025-02-17",
      cible: 60,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2025-03-24",
    mesures: [
      ["2025-02-24", 98],
      ["2025-03-21", 96],
      ["2025-05-19", 78],
      ["2025-06-16", 70],
    ],
  },
  {
    mission: "redressementWouri",
    auteur: "directeur.mission",
    libelle: "Tableau de bord hebdomadaire de trésorerie pour la direction financière",
    type: TDB,
    kpi: {
      libelle: "Trésorerie nette disponible",
      unite: "M XOF",
      sens: "plus_haut_mieux",
      debut: "2025-03-24",
      cible: 400,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2025-05-12",
    mesures: [
      ["2025-04-14", 120],
      ["2025-05-12", 135],
      ["2025-07-14", 250],
      ["2025-09-15", 310],
    ],
  },
  {
    mission: "ddMboa",
    auteur: "associe",
    libelle: "Tableau de bord d'intégration des 100 premiers jours pour l'investisseur",
    type: TDB,
    kpi: {
      libelle: "Avancement du plan d'intégration",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2025-09-15",
      cible: 90,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2025-10-06",
    mesures: [
      ["2025-09-22", 10],
      ["2025-10-06", 12],
      ["2025-11-17", 40],
      ["2025-12-15", 52],
    ],
  },
  {
    mission: "businessPlanAtlantique",
    auteur: "chef.mission",
    libelle: "Tableau de bord de suivi des demandes de financement",
    type: TDB,
    kpi: {
      libelle: "Dossiers de financement complets au premier dépôt",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2026-01-26",
      cible: 90,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2026-03-02",
    mesures: [
      ["2026-02-02", 38],
      ["2026-03-02", 40],
      ["2026-04-13", 72],
      ["2026-05-11", 85],
    ],
  },
  {
    mission: "redressementWouri",
    auteur: "directeur.mission",
    libelle: "Renégocier le profil de remboursement avec les banques créancières",
    type: DETTE,
    kpi: {
      libelle: "Charge d'intérêts annuelle",
      unite: "M XOF",
      sens: "plus_bas_mieux",
      debut: "2025-03-24",
      cible: 360,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2025-07-07",
    mesures: [
      ["2025-06-16", 480],
      ["2025-07-07", 480],
      ["2025-09-15", 440],
      ["2025-10-13", 420],
    ],
  },
  {
    mission: "businessPlanAtlantique",
    auteur: "chef.mission",
    libelle: "Renégocier les crédits existants avant de lever le nouveau financement",
    type: DETTE,
    kpi: {
      libelle: "Taux moyen des crédits",
      unite: "%",
      sens: "plus_bas_mieux",
      debut: "2026-01-26",
      cible: 8,
    },
    statut: "mise_en_oeuvre",
    miseEnOeuvre: "2026-03-23",
    mesures: [
      ["2026-02-23", 9.5],
      ["2026-03-23", 9.5],
      ["2026-05-18", 8.9],
      ["2026-06-15", 8.6],
    ],
  },
  {
    mission: "notationSahel",
    auteur: "chef.mission",
    libelle: "Digitaliser le recouvrement des créances par des relances automatiques",
    type: "Digitalisation du recouvrement",
    kpi: {
      libelle: "Taux de recouvrement à 30 jours",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2025-02-17",
      cible: 85,
    },
    statut: "abandonnee",
    motifAbandon:
      "Coût de mise en oeuvre supérieur aux gains attendus pour une équipe comptable de cette taille ; le client préfère renforcer les relances téléphoniques.",
    mesures: [["2025-03-17", 62]],
  },
  {
    mission: "planSicafe",
    auteur: "chef.mission",
    libelle: "Former les équipes commerciales à la négociation des contrats de campagne",
    type: "Formation des équipes commerciales",
    kpi: {
      libelle: "Taux de transformation des offres en contrats",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2025-01-20",
      cible: 35,
    },
    statut: "recommandee",
    mesures: [["2025-02-17", 24]],
  },
  {
    mission: "ddMboa",
    auteur: "associe",
    libelle: "Réviser les garanties de performance des centrales dans les contrats clients",
    type: "Sécurisation contractuelle",
    kpi: {
      libelle: "Disponibilité moyenne des centrales",
      unite: "%",
      sens: "plus_haut_mieux",
      debut: "2025-09-15",
      cible: 97,
    },
    statut: "recommandee",
    mesures: [["2025-10-20", 93.5]],
  },
  {
    mission: "businessPlanAtlantique",
    auteur: "chef.mission",
    libelle: "Créer un comité d'investissement interne pour accélérer les décisions",
    type: "Gouvernance des investissements",
    kpi: {
      libelle: "Délai de décision d'investissement",
      unite: "jours",
      sens: "plus_bas_mieux",
      debut: "2026-01-26",
      cible: 30,
    },
    statut: "mise_en_oeuvre",
    // Mission clôturée le 31 juillet 2026 : suivi et mesures restent avant la clôture.
    miseEnOeuvre: "2026-07-16",
    mesures: [
      ["2026-06-22", 55],
      ["2026-07-16", 54],
    ],
  },
];
