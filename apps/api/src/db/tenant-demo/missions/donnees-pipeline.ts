import type { CleClient, CleCompteCabinet } from "../cles.js";

/*
 * Pipeline commercial du Tenant démo en plus des 11 opportunités gagnées du casting : des
 * opportunités perdues (avec leur motif, parfois après une proposition refusée) et des
 * opportunités ouvertes à chaque étape. Les montants sont des estimations commerciales saisies
 * par le chef de mission ; les prix des propositions, eux, viennent des barèmes (moteurs).
 */

export interface DefOpportunite {
  intitule: string;
  client: CleClient;
  type: string;
  montant: number;
  probabilite: number;
  etape: "prospection" | "qualification" | "proposition" | "negociation";
  /** Chef de mission qui porte l'opportunité. */
  chef: CleCompteCabinet;
  /** Associé qui valide la proposition (quatre yeux). */
  associe: CleCompteCabinet;
  /** Date de création de l'opportunité. */
  date: string;
  /** Avancement de la proposition : absente, validée, envoyée ou refusée par le client. */
  proposition?: "validee" | "envoyee" | "refusee";
  /** Issue : l'opportunité est perdue à cette date, pour ce motif. */
  perdue?: { date: string; motif: string };
}

export const OPPORTUNITES_COMPLEMENTAIRES: readonly DefOpportunite[] = [
  {
    intitule: "Audit organisationnel — Teranga Logistique",
    client: "teranga-logistique",
    type: "audit_organisationnel",
    montant: 14_500_000,
    probabilite: 40,
    etape: "negociation",
    chef: "chef.mission",
    associe: "associe",
    date: "2025-03-17",
    proposition: "refusee",
    perdue: {
      date: "2025-05-12",
      motif: "Le client a retenu un cabinet local mieux-disant sur le prix.",
    },
  },
  {
    intitule: "Assistance à la structuration financière — SICAFÉ Transformation",
    client: "sicafe-transformation",
    type: "assistance",
    montant: 6_000_000,
    probabilite: 30,
    etape: "proposition",
    chef: "chef.mission",
    associe: "associe.2",
    date: "2025-06-02",
    proposition: "envoyee",
    perdue: {
      date: "2025-07-21",
      motif: "Prestation internalisée par la direction financière du client.",
    },
  },
  {
    intitule: "Formation des managers de proximité — Atlantique Retail",
    client: "atlantique-retail",
    type: "formation",
    montant: 7_500_000,
    probabilite: 25,
    etape: "qualification",
    chef: "chef.mission.2",
    associe: "associe",
    date: "2025-07-07",
    perdue: { date: "2025-08-04", motif: "Budget de formation reporté à l'exercice suivant." },
  },
  {
    intitule: "Plan stratégique 2026-2030 — Gabon Offshore Services",
    client: "gabon-offshore",
    type: "plan_strategique",
    montant: 21_000_000,
    probabilite: 35,
    etape: "negociation",
    chef: "chef.mission.2",
    associe: "associe.2",
    date: "2025-09-15",
    proposition: "refusee",
    perdue: {
      date: "2025-11-10",
      motif: "Projet suspendu par la direction : priorité donnée à la restructuration de la dette.",
    },
  },
  {
    intitule: "Due diligence — Baobab Assurances (acquisition d'un courtier)",
    client: "baobab-assurances",
    type: "due_diligence",
    montant: 16_500_000,
    probabilite: 50,
    etape: "proposition",
    chef: "chef.mission",
    associe: "associe.2",
    date: "2026-01-12",
    proposition: "envoyee",
    perdue: { date: "2026-02-09", motif: "Opération abandonnée par l'actionnaire de contrôle." },
  },
  {
    intitule: "Business plan bancable — Mboa Solaire (extension de capacité)",
    client: "mboa-solaire",
    type: "business_plan_bancable",
    montant: 12_000_000,
    probabilite: 70,
    etape: "negociation",
    chef: "chef.mission.2",
    associe: "associe",
    date: "2026-08-10",
    proposition: "envoyee",
  },
  {
    intitule: "Notation financière — Sahel Coton (revue annuelle)",
    client: "sahel-coton",
    type: "notation_financiere",
    montant: 9_000_000,
    probabilite: 60,
    etape: "proposition",
    chef: "chef.mission",
    associe: "associe.2",
    date: "2026-09-01",
    proposition: "validee",
  },
  {
    intitule: "Diagnostic flash — SICAFÉ Transformation",
    client: "sicafe-transformation",
    type: "diagnostic_flash",
    montant: 1_800_000,
    probabilite: 50,
    etape: "qualification",
    chef: "chef.mission.2",
    associe: "associe",
    date: "2026-10-05",
  },
  {
    intitule: "Audit organisationnel — Banque du Sahel Microfinance (réseau d'agences)",
    client: "banque-sahel",
    type: "audit_organisationnel",
    montant: 18_000_000,
    probabilite: 30,
    etape: "qualification",
    chef: "chef.mission",
    associe: "associe",
    date: "2026-09-21",
  },
  {
    intitule: "Plan stratégique 2027-2031 — Brasseries du Wouri",
    client: "brasseries-wouri",
    type: "plan_strategique",
    montant: 24_000_000,
    probabilite: 25,
    etape: "prospection",
    chef: "chef.mission",
    associe: "associe",
    date: "2026-10-12",
  },
  {
    intitule: "Redressement — Wouri Distribution (suite de la due diligence)",
    client: "wouri-distribution",
    type: "redressement",
    montant: 30_000_000,
    probabilite: 15,
    etape: "prospection",
    chef: "chef.mission.2",
    associe: "associe.2",
    date: "2026-10-19",
  },
];
