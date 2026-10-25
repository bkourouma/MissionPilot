import type { CleCompte } from "../cles.js";
import type { CleMission } from "./commun.js";
import { uuidStable } from "./automatisation-donnees.js";

/*
 * Événements métier passés du seed Tenant démo (jalons, KPI, questionnaires) et décisions prises
 * sur les brouillons que les règles ont produits. Voir automatisation-donnees.ts pour les règles.
 */

/* ----- Événements ----- */

export interface EvenementDemo {
  /** Référence stable (partie de la clé d'idempotence). */
  ref: string;
  code:
    | "mission.jalon_atteint"
    | "mission.cloture_demandee"
    | "kpi.rouge_deux_periodes"
    | "questionnaire.sans_reponse";
  mission: CleMission;
  /** Jour ISO (midi UTC) ; pour les missions du casting, voir `jourEvenement`. */
  date: string;
  /** Heure de la journée en minutes après midi UTC (étale les événements d'un même jour). */
  minutes?: number;
  payload: Record<string, unknown>;
}

const jalon = (ref: string, mission: CleMission, date: string, libelle: string): EvenementDemo => ({
  ref,
  code: "mission.jalon_atteint",
  mission,
  date,
  payload: { jalon_id: uuidStable(`jalon:${ref}`), libelle },
});

const kpi = (
  ref: string,
  mission: CleMission,
  date: string,
  libelle: string,
  periode: string,
  periodesRouges: number,
): EvenementDemo => ({
  ref,
  code: "kpi.rouge_deux_periodes",
  mission,
  date,
  minutes: -270,
  payload: {
    kpi_id: uuidStable(`kpi:${mission}:${libelle}`),
    libelle,
    periode,
    periodes_rouges: periodesRouges,
  },
});

const questionnaire = (
  ref: string,
  mission: CleMission,
  date: string,
  titre: string,
  jours: number,
  enAttente: number,
): EvenementDemo => ({
  ref,
  code: "questionnaire.sans_reponse",
  mission,
  date,
  minutes: -270,
  payload: {
    envoi_id: uuidStable(`envoi:${mission}:${titre}`),
    titre,
    jours_sans_reponse: jours,
    repondants_en_attente: enAttente,
  },
});

/** Événements de jalon, de KPI et de questionnaire (les clôtures sont dérivées du casting). */
export const EVENEMENTS_FIXES = (jourRecent: (avant: number) => string): EvenementDemo[] => [
  jalon("jalon-plan-sicafe-1", "plan-sicafe", "2024-12-19", "Validation du diagnostic stratégique"),
  jalon(
    "jalon-plan-sicafe-2",
    "plan-sicafe",
    "2025-03-04",
    "Présentation du plan au comité de direction",
  ),
  jalon(
    "jalon-notation-sahel-1",
    "notation-sahel-coton",
    "2025-03-15",
    "Remise de la grille de notation",
  ),
  jalon(
    "jalon-wouri-1",
    "redressement-wouri",
    "2025-05-09",
    "Plan de redressement validé par le comité",
  ),
  jalon("jalon-wouri-2", "redressement-wouri", "2025-08-07", "Accord signé avec les créanciers"),
  jalon("jalon-dd-mboa-1", "dd-mboa", "2025-10-06", "Rapport de due diligence provisoire"),
  jalon("jalon-bp-atlantique-1", "bp-atlantique", "2026-03-08", "Modèle financier validé"),
  jalon("jalon-bp-atlantique-2", "bp-atlantique", "2026-04-22", "Dossier bancaire déposé"),
  jalon("jalon-baobab-1", "plan-baobab", "2026-07-23", "Diagnostic stratégique livré"),
  jalon("jalon-baobab-2", "plan-baobab", "2026-09-06", "Ateliers de cadrage terminés"),
  jalon("jalon-gabon-1", "redressement-gabon", "2026-08-15", "Diagnostic de trésorerie livré"),
  jalon(
    "jalon-banque-sahel-1",
    "notation-banque-sahel",
    "2026-09-23",
    "Échantillon de PME analysé",
  ),
  jalon("jalon-teranga-1", "flash-teranga", "2026-09-28", "Entretiens de diagnostic terminés"),
  kpi(
    "kpi-wouri-2025-07",
    "redressement-wouri",
    "2025-08-12",
    "Marge brute mensuelle",
    "2025-07",
    2,
  ),
  kpi(
    "kpi-wouri-2025-08",
    "redressement-wouri",
    "2025-09-11",
    "Marge brute mensuelle",
    "2025-08",
    3,
  ),
  kpi(
    "kpi-bp-2026-02",
    "bp-atlantique",
    "2026-03-17",
    "Taux de réalisation du plan de travail",
    "2026-02",
    2,
  ),
  kpi(
    "kpi-baobab-2026-08",
    "plan-baobab",
    "2026-09-14",
    "Délai de livraison des supports (jours)",
    "2026-08",
    2,
  ),
  kpi(
    "kpi-baobab-2026-09",
    "plan-baobab",
    "2026-10-14",
    "Délai de livraison des supports (jours)",
    "2026-09",
    3,
  ),
  kpi(
    "kpi-gabon-2026-09",
    "redressement-gabon",
    jourRecent(6),
    "Délai moyen d'encaissement (jours)",
    "2026-09",
    2,
  ),
  kpi(
    "kpi-banque-sahel-2026-09",
    "notation-banque-sahel",
    jourRecent(4),
    "Dossiers PME notés dans les délais",
    "2026-09",
    2,
  ),
  kpi(
    "kpi-baobab-ateliers-2026-09",
    "plan-baobab",
    jourRecent(3),
    "Taux de participation aux ateliers",
    "2026-09",
    2,
  ),
  questionnaire(
    "quest-mboa-j3",
    "dd-mboa",
    "2025-11-06",
    "Questionnaire de satisfaction — due diligence",
    3,
    4,
  ),
  questionnaire(
    "quest-mboa-j7",
    "dd-mboa",
    "2025-11-10",
    "Questionnaire de satisfaction — due diligence",
    7,
    3,
  ),
  questionnaire(
    "quest-mboa-j10",
    "dd-mboa",
    "2025-11-13",
    "Questionnaire de satisfaction — due diligence",
    10,
    2,
  ),
  questionnaire(
    "quest-baobab-j3",
    "plan-baobab",
    "2026-09-24",
    "Questionnaire de satisfaction à mi-parcours",
    3,
    6,
  ),
  questionnaire(
    "quest-baobab-j7",
    "plan-baobab",
    "2026-09-28",
    "Questionnaire de satisfaction à mi-parcours",
    7,
    4,
  ),
  questionnaire(
    "quest-baobab-j10",
    "plan-baobab",
    "2026-10-01",
    "Questionnaire de satisfaction à mi-parcours",
    10,
    3,
  ),
  questionnaire(
    "quest-baobab-j14",
    "plan-baobab",
    "2026-10-05",
    "Questionnaire de satisfaction à mi-parcours",
    14,
    2,
  ),
  questionnaire(
    "quest-teranga-j3",
    "flash-teranga",
    "2026-10-08",
    "Questionnaire flash — direction générale",
    3,
    3,
  ),
  questionnaire(
    "quest-teranga-j7",
    "flash-teranga",
    "2026-10-12",
    "Questionnaire flash — direction générale",
    7,
    2,
  ),
];

/* ----- Décisions sur les brouillons (par référence d'événement) ----- */

export type PlanDecision =
  | {
      type: "historique";
      decision: "validee" | "rejetee";
      auteur: CleCompte;
      apresHeures: number;
      motif?: string;
    }
  | {
      type: "historique";
      decision: "modifiee";
      auteur: CleCompte;
      apresHeures: number;
      texteFinal: string;
    }
  | { type: "annulation"; auteur: CleCompte; apresHeures: number; motif: string }
  /** Décision prise par la route à l'exécution du seed (date du jour de l'exécution). */
  | { type: "route_decision"; auteur: CleCompte }
  | { type: "route_annulation"; auteur: CleCompte; motif: string };

export const DECISIONS: Record<string, PlanDecision> = {
  "jalon-plan-sicafe-2": {
    type: "historique",
    decision: "validee",
    auteur: "chef.mission",
    apresHeures: 20,
  },
  "jalon-notation-sahel-1": {
    type: "historique",
    decision: "modifiee",
    auteur: "chef.mission",
    apresHeures: 44,
    texteFinal:
      "La grille de notation est remise au client. Prévoir au prochain point de suivi la validation des pondérations avec la direction financière de Sahel Coton.",
  },
  "jalon-wouri-1": {
    type: "historique",
    decision: "validee",
    auteur: "chef.mission",
    apresHeures: 18,
  },
  "jalon-wouri-2": {
    type: "historique",
    decision: "rejetee",
    auteur: "chef.mission",
    apresHeures: 70,
    motif: "Doublon avec le compte rendu du comité des créanciers du 8 août.",
  },
  "jalon-dd-mboa-1": {
    type: "historique",
    decision: "validee",
    auteur: "chef.mission",
    apresHeures: 26,
  },
  "kpi-wouri-2025-07": {
    type: "annulation",
    auteur: "directeur.mission",
    apresHeures: 30,
    motif: "Note générée par erreur : le KPI avait déjà été clos avec le client.",
  },
  "kpi-bp-2026-02": {
    type: "historique",
    decision: "modifiee",
    auteur: "chef.mission",
    apresHeures: 52,
    texteFinal:
      "Le taux de réalisation du plan de travail est au rouge depuis deux périodes. Replanifier les livrables restants avec l'équipe d'Atlantique Retail et acter le nouveau calendrier au prochain comité.",
  },
  "kpi-baobab-2026-08": {
    type: "historique",
    decision: "rejetee",
    auteur: "chef.mission",
    apresHeures: 31,
    motif: "Écart déjà traité en atelier avec le client : action corrective en cours.",
  },
  "kpi-gabon-2026-09": { type: "route_decision", auteur: "chef.mission" },
  "kpi-banque-sahel-2026-09": {
    type: "route_annulation",
    auteur: "directeur.mission",
    motif:
      "Mesure de septembre à reprendre : le portefeuille de PME a été mis à jour par la banque.",
  },
  // « kpi-baobab-ateliers-2026-09 » : laissé à valider (brouillon en attente).
};
