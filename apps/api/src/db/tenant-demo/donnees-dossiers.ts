import type { Alea } from "./horloge.js";
import type { CleClient } from "./cles.js";
import type { DeviseClient } from "./donnees-clients.js";

/*
 * Données des barèmes négociés (FIN-02), des participations de groupe (DOS-05) et des états
 * financiers (DOS-03) du cabinet « Tenant démo ». Les faits des dossiers sont dans
 * donnees-faits.ts. Aucun montant ne vient d'un modèle de langage : ce sont des chiffres de
 * démonstration fixés ici (les contrôles de l'état financier sont ceux du moteur).
 */

/* ----- Taux négociés ----- */

export const GRADES_TAUX = ["senior", "manager", "directeur", "associe"] as const;
export type GradeTaux = (typeof GRADES_TAUX)[number];

/** Taux journaliers de vente de référence (unités entières de la devise) avant remise du client. */
export const TAUX_REFERENCE: Record<DeviseClient, Record<GradeTaux, number>> = {
  XOF: { senior: 180_000, manager: 260_000, directeur: 380_000, associe: 520_000 },
  XAF: { senior: 180_000, manager: 260_000, directeur: 380_000, associe: 520_000 },
  EUR: { senior: 750, manager: 1050, directeur: 1500, associe: 2000 },
  USD: { senior: 850, manager: 1200, directeur: 1700, associe: 2300 },
};

export interface DefTauxClient {
  cle: CleClient;
  /** Pourcentage du taux de référence négocié (95 = 5 % de remise). */
  pourcentage: number;
  /** Début de validité du barème négocié. */
  valide_du: string;
  /** Révision : le barème initial s'arrête la veille de `depuis`, le nouveau pourcentage prend le relais. */
  revision?: { depuis: string; pourcentage: number };
}

/** 8 clients ont un barème négocié ; sicafe a une révision au 2026-01-01. */
export const TAUX_CLIENTS: readonly DefTauxClient[] = [
  {
    cle: "sicafe",
    pourcentage: 92,
    valide_du: "2025-01-01",
    revision: { depuis: "2026-01-01", pourcentage: 97 },
  },
  { cle: "sicafe-transformation", pourcentage: 95, valide_du: "2025-03-01" },
  { cle: "brasseries-wouri", pourcentage: 90, valide_du: "2025-01-01" },
  { cle: "teranga-logistique", pourcentage: 94, valide_du: "2025-07-01" },
  { cle: "baobab-assurances", pourcentage: 100, valide_du: "2025-10-01" },
  { cle: "sahel-coton", pourcentage: 88, valide_du: "2025-12-01" },
  { cle: "atlantique-retail", pourcentage: 100, valide_du: "2026-03-01" },
  { cle: "gabon-offshore", pourcentage: 105, valide_du: "2026-07-01" },
];

/** Taux arrondi au millier (XOF, XAF) ou à 5 unités (EUR, USD). */
export function tauxNegocie(devise: DeviseClient, grade: GradeTaux, pourcentage: number): number {
  const pas = devise === "XOF" || devise === "XAF" ? 1000 : 5;
  return Math.round((TAUX_REFERENCE[devise][grade] * pourcentage) / 100 / pas) * pas;
}

/* ----- Participations ----- */

export interface DefParticipation {
  detenteur: CleClient;
  filiale: CleClient;
  /** Points de base : 10 000 = 100 %. */
  points_base: number;
  date_effet: string;
  motif?: string;
}

/** Historique en ajout seul, dans l'ordre chronologique. */
export const PARTICIPATIONS: readonly DefParticipation[] = [
  {
    detenteur: "sicafe",
    filiale: "sicafe-transformation",
    points_base: 10_000,
    date_effet: "2025-01-01",
  },
  { detenteur: "sicafe", filiale: "sicafe-export", points_base: 7_500, date_effet: "2025-01-01" },
  {
    detenteur: "brasseries-wouri",
    filiale: "wouri-distribution",
    points_base: 6_000,
    date_effet: "2025-03-01",
  },
  {
    detenteur: "sicafe",
    filiale: "sicafe-export",
    points_base: 8_000,
    date_effet: "2026-01-01",
    motif: "Rachat de parts d'un actionnaire minoritaire",
  },
];

/* ----- États financiers (saisie structurée) ----- */

export interface DefEtat {
  cle: CleClient;
  exercice: number;
  produits: number;
  charges: number;
}

/** 2 exercices (2024 et 2025) pour 4 gros clients, dans leur devise de facturation. */
export const ETATS: readonly DefEtat[] = [
  { cle: "sicafe", exercice: 2024, produits: 48_500_000_000, charges: 45_900_000_000 },
  { cle: "sicafe", exercice: 2025, produits: 53_200_000_000, charges: 49_800_000_000 },
  { cle: "brasseries-wouri", exercice: 2024, produits: 72_000_000_000, charges: 68_300_000_000 },
  { cle: "brasseries-wouri", exercice: 2025, produits: 76_400_000_000, charges: 71_900_000_000 },
  { cle: "teranga-logistique", exercice: 2024, produits: 9_800_000_000, charges: 9_150_000_000 },
  { cle: "teranga-logistique", exercice: 2025, produits: 11_200_000_000, charges: 10_400_000_000 },
  { cle: "atlantique-retail", exercice: 2024, produits: 310_000_000, charges: 302_000_000 },
  { cle: "atlantique-retail", exercice: 2025, produits: 335_000_000, charges: 322_000_000 },
];

const millier = (x: number): number => Math.round(x / 1000) * 1000;

interface LigneEtat {
  code: string;
  libelle: string;
  section: "actif" | "passif" | "charges" | "produits" | "resultat";
  montant: number;
  role?: "total" | "resultat_exercice" | "resultat_net";
}

/**
 * Lignes d'un bilan et d'un compte de résultat ÉQUILIBRÉS (actif = passif, résultat net =
 * produits − charges) : les contrôles du moteur passent, l'état est accepté automatiquement.
 * Le hasard (graine du cabinet) ne fait varier que la structure du bilan.
 */
export function lignesEtat(d: DefEtat, alea: Alea): LigneEtat[] {
  const net = d.produits - d.charges;
  const actif = millier(d.produits * (0.8 + alea.suivant() * 0.25));
  const immos = millier(actif * (0.36 + alea.suivant() * 0.1));
  const stocks = millier(actif * (0.14 + alea.suivant() * 0.08));
  const creances = millier(actif * (0.2 + alea.suivant() * 0.08));
  const tresorerie = actif - immos - stocks - creances;
  const dettesFin = millier(actif * (0.18 + alea.suivant() * 0.08));
  const dettesExpl = millier(actif * (0.24 + alea.suivant() * 0.06));
  const capitaux = actif - net - dettesFin - dettesExpl;
  const achats = millier(d.charges * 0.55);
  const personnel = millier(d.charges * 0.22);
  const ventes = millier(d.produits * 0.96);
  return [
    { code: "A1", libelle: "Immobilisations", section: "actif", montant: immos },
    { code: "A2", libelle: "Stocks", section: "actif", montant: stocks },
    {
      code: "A3",
      libelle: "Créances clients et autres créances",
      section: "actif",
      montant: creances,
    },
    { code: "A4", libelle: "Trésorerie", section: "actif", montant: tresorerie },
    { code: "TA", libelle: "Total de l'actif", section: "actif", montant: actif, role: "total" },
    { code: "P1", libelle: "Capitaux propres et réserves", section: "passif", montant: capitaux },
    {
      code: "P2",
      libelle: "Résultat de l'exercice",
      section: "passif",
      montant: net,
      role: "resultat_exercice",
    },
    { code: "P3", libelle: "Dettes financières", section: "passif", montant: dettesFin },
    { code: "P4", libelle: "Dettes d'exploitation", section: "passif", montant: dettesExpl },
    { code: "TP", libelle: "Total du passif", section: "passif", montant: actif, role: "total" },
    { code: "C1", libelle: "Achats consommés", section: "charges", montant: achats },
    { code: "C2", libelle: "Charges de personnel", section: "charges", montant: personnel },
    {
      code: "C3",
      libelle: "Autres charges d'exploitation",
      section: "charges",
      montant: d.charges - achats - personnel,
    },
    {
      code: "TC",
      libelle: "Total des charges",
      section: "charges",
      montant: d.charges,
      role: "total",
    },
    { code: "R1", libelle: "Ventes et prestations", section: "produits", montant: ventes },
    { code: "R2", libelle: "Autres produits", section: "produits", montant: d.produits - ventes },
    {
      code: "TR",
      libelle: "Total des produits",
      section: "produits",
      montant: d.produits,
      role: "total",
    },
    {
      code: "RN",
      libelle: "Résultat net déclaré",
      section: "resultat",
      montant: net,
      role: "resultat_net",
    },
  ];
}
