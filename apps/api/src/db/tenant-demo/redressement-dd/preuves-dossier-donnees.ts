import type {
  FiabilitePreuve,
  TypeSourcePreuve,
  ValeurFacteurContexte,
  ValeurFaitDossier,
} from "@missionpilot/shared";
import { MISSIONS, type NomMission } from "./commun.js";
import type { CleActeur } from "./preuves-ecriture.js";

/*
 * Données du dossier client des cinq clients des missions 1 à 5 (constats FICTIFS, cohérents avec
 * le registre des preuves de preuves-donnees-*.ts) : faits proposés puis décidés, décisions sur des
 * faits déjà proposés par le socle, facteurs de contexte (avec historique) et exports.
 *
 * Séparation des tâches : l'auteur d'une proposition ne la décide jamais (le compte qui décide est
 * toujours différent de celui qui propose ; le socle a proposé ses faits avec le compte associé).
 */

export interface SourceDef {
  type: TypeSourcePreuve;
  libelle: string;
}

export interface DecisionDef {
  decision: "confirme" | "rejete";
  par: CleActeur;
  /** Jour de la mission (décalage depuis le début). */
  j: number;
  motif?: string;
}

export interface DefFait {
  mission: NomMission;
  categorie:
    | "profil"
    | "organisation"
    | "processus"
    | "produits_marches"
    | "finances"
    | "risques"
    | "parties_prenantes";
  cle: string;
  valeur: ValeurFaitDossier;
  /** Date d'effet ISO. */
  effet: string;
  source: SourceDef;
  fiabilite: FiabilitePreuve;
  par: CleActeur;
  /** Jour de la mission où le fait est proposé. */
  j: number;
  /** Remplace le fait précédent de même catégorie et de même clé pour cette mission. */
  remplace?: boolean;
  decision?: DecisionDef;
}

export interface DefDecisionSocle {
  mission: NomMission;
  categorie: DefFait["categorie"];
  cle: string;
  decision: DecisionDef["decision"];
  par: CleActeur;
  motif?: string;
}

export interface DefFacteur {
  mission: NomMission;
  code: string;
  type: "booleen" | "nombre" | "enumeration" | "liste";
  valeur: ValeurFacteurContexte;
  /** Date d'effet ISO (le facteur est enregistré ce jour-là). */
  effet: string;
  source: SourceDef;
  fiabilite: FiabilitePreuve;
  par: CleActeur;
}

export interface DefExport {
  mission: NomMission;
  format: "json" | "zip";
  par: CleActeur;
  /** Jour ISO de la demande (après la fin de la mission). */
  jour: string;
}

const nombre = (n: number): ValeurFaitDossier => ({ type: "nombre", nombre: n });
const xof = (montant: number): ValeurFaitDossier => ({ type: "montant", montant, devise: "XOF" });

export const FAITS: DefFait[] = [
  // --- Mission 1 : SICAFÉ ---
  {
    mission: MISSIONS.plan2025,
    categorie: "finances",
    cle: "marge_brute_2024_pct",
    valeur: nombre(20.7),
    effet: "2024-12-31",
    source: {
      type: "document",
      libelle: "Comptes certifiés SICAFÉ 2022-2024 (rapport du commissaire aux comptes)",
    },
    fiabilite: "A",
    par: "consultant",
    j: 61,
    decision: { decision: "confirme", par: "directeur", j: 63 },
  },
  {
    mission: MISSIONS.plan2025,
    categorie: "processus",
    cle: "taux_utilisation_broyage_annuel_pct",
    valeur: nombre(79),
    effet: "2024-12-31",
    source: {
      type: "document",
      libelle: "Fiche de production de l'usine d'Abidjan, exercice 2024",
    },
    fiabilite: "B",
    par: "consultant2",
    j: 46,
    decision: { decision: "confirme", par: "chef", j: 48 },
  },
  {
    mission: MISSIONS.plan2025,
    categorie: "parties_prenantes",
    cle: "premier_acheteur_europe_part_exports_pct",
    valeur: nombre(35),
    effet: "2024-11-14",
    source: {
      type: "entretien",
      libelle: "Entretien avec la directrice commerciale, 14 novembre 2024",
    },
    fiabilite: "C",
    par: "junior",
    j: 12,
    decision: {
      decision: "rejete",
      par: "chef",
      j: 20,
      motif:
        "Part déclarée oralement, non retrouvée dans les contrats d'exportation. À reproposer avec les contrats.",
    },
  },
  // --- Mission 2 : Sahel Coton ---
  {
    mission: MISSIONS.notation,
    categorie: "finances",
    cle: "fonds_roulement_2024",
    valeur: xof(-4_200_000_000),
    effet: "2024-12-31",
    source: {
      type: "document",
      libelle: "États financiers certifiés de Sahel Coton Mali, exercices 2022 à 2024",
    },
    fiabilite: "A",
    par: "consultant",
    j: 6,
    decision: { decision: "confirme", par: "directeur2", j: 10 },
  },
  {
    mission: MISSIONS.notation,
    categorie: "produits_marches",
    cle: "prix_achat_producteur_xof_kg",
    valeur: nombre(285),
    effet: "2025-01-15",
    source: {
      type: "donnee_externe",
      libelle: "Bulletin de campagne de l'interprofession cotonnière, prix 2024/25",
    },
    fiabilite: "B",
    par: "junior",
    j: 26,
    decision: { decision: "confirme", par: "consultant2", j: 28 },
  },
  {
    mission: MISSIONS.notation,
    categorie: "processus",
    cle: "stock_coton_graine_koutiala_jours",
    valeur: nombre(14),
    effet: "2025-03-07",
    source: { type: "observation", libelle: "Visite de l'usine de Koutiala, 6 et 7 mars 2025" },
    fiabilite: "B",
    par: "consultant2",
    j: 33,
  },
  // --- Mission 3 : Brasseries du Wouri ---
  {
    mission: MISSIONS.redressementTermine,
    categorie: "finances",
    cle: "delai_moyen_paiement_fournisseurs_jours",
    valeur: nombre(118),
    effet: "2025-03-31",
    source: { type: "document", libelle: "Échéancier des dettes fournisseurs au 31 mars 2025" },
    fiabilite: "B",
    par: "consultant2",
    j: 22,
    decision: { decision: "confirme", par: "chef2", j: 25 },
  },
  {
    mission: MISSIONS.redressementTermine,
    categorie: "finances",
    cle: "dettes_fournisseurs_echues",
    valeur: xof(6_800_000_000),
    effet: "2025-03-31",
    source: { type: "document", libelle: "Échéancier des dettes fournisseurs au 31 mars 2025" },
    fiabilite: "B",
    par: "consultant",
    j: 22,
    decision: { decision: "confirme", par: "directeur2", j: 26 },
  },
  {
    mission: MISSIONS.redressementTermine,
    categorie: "finances",
    cle: "dettes_fournisseurs_echues",
    valeur: xof(5_100_000_000),
    effet: "2025-06-30",
    source: { type: "document", libelle: "Échéancier des dettes fournisseurs au 30 juin 2025" },
    fiabilite: "B",
    par: "consultant2",
    j: 113,
    remplace: true,
    decision: { decision: "confirme", par: "directeur", j: 116 },
  },
  // --- Mission 4 : Mboa Solaire ---
  {
    mission: MISSIONS.ddTerminee,
    categorie: "produits_marches",
    cle: "carnet_commandes_part_ca_2026_pct",
    valeur: nombre(60),
    effet: "2025-09-15",
    source: {
      type: "document",
      libelle: "Carnet de commandes de Mboa Énergie Solaire au 15 septembre 2025",
    },
    fiabilite: "A",
    par: "consultant",
    j: 51,
    decision: { decision: "confirme", par: "directeur", j: 53 },
  },
  {
    mission: MISSIONS.ddTerminee,
    categorie: "finances",
    cle: "cout_maintenance_annuel_xof_kwc",
    valeur: nombre(9000),
    effet: "2025-10-15",
    source: {
      type: "donnee_externe",
      libelle: "Estimation du cabinet (médiane régionale et contrats clients)",
    },
    fiabilite: "C",
    par: "consultant2",
    j: 42,
    decision: {
      decision: "rejete",
      par: "directeur2",
      j: 45,
      motif:
        "Estimation du cabinet et non fait établi du client : à conserver comme hypothèse du registre des preuves, pas dans le dossier.",
    },
  },
  {
    mission: MISSIONS.ddTerminee,
    categorie: "produits_marches",
    cle: "tarif_reglemente_basse_tension_xof_kwh",
    valeur: nombre(98),
    effet: "2025-01-01",
    source: {
      type: "donnee_externe",
      libelle: "Arrêté tarifaire 2025 de la régie nationale d'électricité",
    },
    fiabilite: "A",
    par: "junior",
    j: 27,
    decision: { decision: "confirme", par: "consultant2", j: 29 },
  },
  // --- Mission 5 : Atlantique Retail ---
  {
    mission: MISSIONS.businessPlan,
    categorie: "finances",
    cle: "marge_brute_2025_pct",
    valeur: nombre(26.4),
    effet: "2025-12-31",
    source: { type: "document", libelle: "Comptes de gestion 2025 par magasin (42 magasins)" },
    fiabilite: "B",
    par: "consultant",
    j: 15,
    decision: { decision: "confirme", par: "directeur2", j: 18 },
  },
  {
    mission: MISSIONS.businessPlan,
    categorie: "organisation",
    cle: "magasins_deficitaires",
    valeur: nombre(9),
    effet: "2025-12-31",
    source: { type: "document", libelle: "Comptes de gestion 2025 par magasin (42 magasins)" },
    fiabilite: "B",
    par: "consultant2",
    j: 15,
    decision: { decision: "confirme", par: "chef2", j: 20 },
  },
  {
    mission: MISSIONS.businessPlan,
    categorie: "finances",
    cle: "besoin_financement_plan",
    valeur: xof(9_500_000_000),
    effet: "2026-01-12",
    source: {
      type: "document",
      libelle: "Business plan 2026-2030, version de la direction (novembre 2025)",
    },
    fiabilite: "C",
    par: "consultant",
    j: 12,
  },
];

/** Faits déjà proposés par le socle (compte associé) : décidés par un autre compte. */
export const DECISIONS_SOCLE: DefDecisionSocle[] = [
  {
    mission: MISSIONS.notation,
    categorie: "risques",
    cle: "securite_zones_production",
    decision: "confirme",
    par: "directeur2",
  },
  {
    mission: MISSIONS.ddTerminee,
    categorie: "risques",
    cle: "dependance_composants_importes",
    decision: "confirme",
    par: "chef2",
  },
  {
    mission: MISSIONS.businessPlan,
    categorie: "risques",
    cle: "tension_marge_commerciale",
    decision: "confirme",
    par: "directeur",
  },
];
