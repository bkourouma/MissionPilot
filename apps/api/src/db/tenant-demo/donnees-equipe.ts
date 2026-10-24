import type { TypeCollaborateur } from "@missionpilot/shared";
import { COMPTES_CABINET } from "./donnees-comptes.js";
import type { CleCollaborateur, CleCollaborateurSansCompte } from "./cles.js";

/*
 * Données pures de l'équipe du cabinet « Tenant démo » : collaborateurs, profils (compétences,
 * secteurs, langues, capacité) et paramètres de l'historique des coûts. Noms fictifs (personnes
 * africaines francophones), jamais d'identité réelle. Aucun appel réseau ni base ici.
 *
 * Données financières (FIN-02) : les montants ci-dessous ne sont posés que par la session d'un
 * rôle qui détient `taux.gerer` (associé), voir equipe.ts.
 */

/** Grades du référentiel (`catalogue-conseil.ts`) : code -> coût journalier de départ (XOF). */
export const COUT_JOURNALIER_BASE: Readonly<Record<string, number>> = {
  stagiaire: 18_000,
  junior: 40_000,
  senior: 75_000,
  manager: 120_000,
  directeur: 190_000,
  associe: 280_000,
};

/**
 * Taux de vente standard par grade (XOF/jour). Toujours supérieurs au coût journalier du grade
 * (y compris après les révisions) : marge positive pour tous les profils.
 */
export const TAUX_VENTE_GRADE: Readonly<Record<string, number>> = {
  stagiaire: 45_000,
  junior: 110_000,
  senior: 190_000,
  manager: 290_000,
  directeur: 420_000,
  associe: 600_000,
};

/** Révisions de l'historique de coûts : date d'effet et facteur CUMULÉ par rapport au départ. */
export const REVISIONS_COUTS: readonly { date: string; facteur: number }[] = [
  { date: "2025-07-01", facteur: 1.05 },
  { date: "2026-01-01", facteur: 1.092 },
];

export interface DefCollaborateur {
  cle: CleCollaborateur;
  type: TypeCollaborateur;
  /** Code de grade du référentiel. */
  grade: string;
  /** Date d'arrivée : celle du compte, ou propre au collaborateur sans compte. */
  depuis: string;
  /** Départ (dernier jour) : le collaborateur est alors désactivé et n'a plus de révision. */
  depart?: string;
  /** Nom : celui du compte, ou fictif pour un collaborateur sans compte. */
  nom: string;
  competences: string[];
  secteurs: string[];
  langues: string[];
  capacite: number;
  /** Écart du coût de départ au coût de base du grade, en % (hors externes). */
  ajustCoutPct?: number;
  /** Coût d'achat journalier (externes et sous-traitants), XOF. */
  coutAchat?: number;
  /** Taux de vente propre au profil (au lieu du taux du grade), XOF/jour. */
  tauxVente?: number;
}

type Profil = Omit<DefCollaborateur, "cle" | "nom" | "depuis">;

/** Profil (grade, type, compétences…) d'un compte du cabinet qui porte un collaborateur. */
const PROFILS_COMPTES: Partial<Record<CleCollaborateur, Profil>> = {
  associe: {
    type: "interne",
    grade: "associe",
    competences: [
      "Stratégie d'entreprise",
      "Restructuration",
      "Gouvernance",
      "Fusions-acquisitions",
    ],
    secteurs: ["Banque et microfinance", "Agro-industrie", "Énergie"],
    langues: ["français", "anglais", "dioula"],
    capacite: 80,
    ajustCoutPct: 0,
    tauxVente: 650_000,
  },
  "associe.2": {
    type: "interne",
    grade: "associe",
    competences: [
      "Finance d'entreprise",
      "Due diligence",
      "Levée de fonds",
      "Évaluation d'entreprise",
    ],
    secteurs: ["Assurance", "Banque et microfinance", "Distribution"],
    langues: ["français", "anglais", "wolof"],
    capacite: 80,
    ajustCoutPct: -4,
  },
  "directeur.mission": {
    type: "interne",
    grade: "directeur",
    competences: [
      "Pilotage de mission",
      "Plan stratégique",
      "Gestion de projet",
      "Conduite du changement",
    ],
    secteurs: ["Agro-industrie", "Transport et logistique", "Distribution"],
    langues: ["français", "anglais", "bambara"],
    capacite: 100,
    ajustCoutPct: 2,
  },
  "directeur.mission.2": {
    type: "interne",
    grade: "directeur",
    competences: [
      "Audit organisationnel",
      "Transformation digitale",
      "Gestion de projet",
      "Stratégie",
    ],
    secteurs: ["Télécommunications", "Banque et microfinance", "Énergie"],
    langues: ["français", "anglais"],
    capacite: 100,
    ajustCoutPct: -2,
  },
  "chef.mission": {
    type: "interne",
    grade: "manager",
    competences: [
      "Gestion de projet",
      "Audit organisationnel",
      "Contrôle de gestion",
      "Animation d'ateliers",
    ],
    secteurs: ["Agro-industrie", "Distribution"],
    langues: ["français", "anglais", "dioula"],
    capacite: 100,
    ajustCoutPct: 3,
  },
  "chef.mission.2": {
    type: "interne",
    grade: "manager",
    competences: [
      "Systèmes d'information",
      "Gestion de projet",
      "Cartographie des processus",
      "Formation",
    ],
    secteurs: ["Transport et logistique", "Télécommunications"],
    langues: ["français", "anglais"],
    capacite: 100,
    ajustCoutPct: 0,
  },
  consultant: {
    type: "interne",
    grade: "senior",
    competences: [
      "Diagnostic stratégique",
      "Modélisation financière",
      "Business plan",
      "Analyse de marché",
    ],
    secteurs: ["Agro-industrie", "Énergie", "Distribution"],
    langues: ["français", "anglais", "baoulé"],
    capacite: 100,
    ajustCoutPct: 4,
    tauxVente: 210_000,
  },
  "consultant.2": {
    type: "interne",
    grade: "senior",
    competences: ["Audit organisationnel", "Gestion des risques", "Contrôle interne", "Formation"],
    secteurs: ["Banque et microfinance", "Assurance"],
    langues: ["français", "anglais", "wolof"],
    capacite: 100,
    ajustCoutPct: -3,
  },
  "consultant.junior": {
    type: "interne",
    grade: "junior",
    competences: ["Analyse de données", "Modélisation financière", "Études de marché"],
    secteurs: ["Distribution", "Agro-industrie"],
    langues: ["français", "anglais"],
    capacite: 100,
    ajustCoutPct: 2,
  },
  "consultant.junior.2": {
    type: "interne",
    grade: "junior",
    competences: ["Veille concurrentielle", "Tableaux de bord", "Gestion de projet"],
    secteurs: ["Transport et logistique", "Assurance"],
    langues: ["français", "anglais", "bambara"],
    capacite: 100,
    ajustCoutPct: -2,
  },
  "consultant.stagiaire": {
    type: "interne",
    grade: "stagiaire",
    competences: ["Recherche documentaire", "Analyse de données"],
    secteurs: ["Distribution"],
    langues: ["français", "anglais"],
    capacite: 100,
    ajustCoutPct: 0,
  },
  "expert.metier": {
    type: "interne",
    grade: "manager",
    competences: [
      "Finance d'entreprise",
      "Restructuration",
      "Négociation avec les créanciers",
      "Trésorerie",
    ],
    secteurs: ["Banque et microfinance", "Assurance"],
    langues: ["français", "anglais", "arabe"],
    capacite: 100,
    ajustCoutPct: 6,
    tauxVente: 330_000,
  },
  "expert.metier.2": {
    type: "interne",
    grade: "senior",
    competences: ["Systèmes d'information", "Cybersécurité", "Transformation digitale"],
    secteurs: ["Télécommunications", "Banque et microfinance"],
    langues: ["français", "anglais"],
    capacite: 80,
    ajustCoutPct: 3,
  },
  "expert.externe": {
    type: "externe",
    grade: "senior",
    competences: ["Audit comptable", "Normes SYSCOHADA", "Contrôle interne"],
    secteurs: ["Agro-industrie", "Énergie"],
    langues: ["français", "anglais", "haoussa"],
    capacite: 100,
    coutAchat: 100_000,
    tauxVente: 175_000,
  },
  "expert.externe.2": {
    type: "externe",
    grade: "manager",
    competences: ["Fiscalité", "Droit des affaires OHADA", "Structuration de groupe"],
    secteurs: ["Distribution", "Assurance"],
    langues: ["français", "anglais"],
    capacite: 80,
    coutAchat: 150_000,
    tauxVente: 270_000,
  },
};

/** Collaborateurs sans compte : date d'arrivée, nom fictif et profil propres. */
const SANS_COMPTE: Record<
  CleCollaborateurSansCompte,
  { nom: string; depuis: string; depart?: string } & Profil
> = {
  "st.data": {
    nom: "Serge Atangana",
    depuis: "2025-02-10",
    type: "sous_traitant",
    grade: "senior",
    competences: ["Analyse de données", "Data engineering", "Tableaux de bord décisionnels"],
    secteurs: ["Télécommunications", "Distribution"],
    langues: ["français", "anglais"],
    capacite: 100,
    coutAchat: 90_000,
    tauxVente: 160_000,
  },
  "st.juridique": {
    nom: "Gisèle Nkoulou",
    depuis: "2025-04-14",
    type: "sous_traitant",
    grade: "manager",
    competences: ["Droit des sociétés OHADA", "Contrats commerciaux", "Conformité réglementaire"],
    secteurs: ["Banque et microfinance", "Énergie"],
    langues: ["français", "anglais", "lingala"],
    capacite: 100,
    coutAchat: 140_000,
    tauxVente: 250_000,
  },
  "ext.finance": {
    nom: "Ousmane Bamba",
    depuis: "2025-09-15",
    type: "externe",
    grade: "directeur",
    competences: ["Finance de marché", "Évaluation d'entreprise", "Structuration de financements"],
    secteurs: ["Banque et microfinance", "Assurance", "Énergie"],
    langues: ["français", "anglais", "arabe"],
    capacite: 100,
    coutAchat: 230_000,
    tauxVente: 380_000,
  },
  "ex.consultant": {
    nom: "Kévin Dago",
    depuis: "2024-10-01",
    depart: "2025-09-30",
    type: "interne",
    grade: "junior",
    competences: ["Études de marché", "Business plan", "Animation d'ateliers"],
    secteurs: ["Distribution", "Agro-industrie"],
    langues: ["français", "anglais"],
    capacite: 100,
    ajustCoutPct: 1,
  },
  "stagiaire.2": {
    nom: "Inès Boukary",
    depuis: "2026-06-15",
    type: "interne",
    grade: "stagiaire",
    competences: ["Recherche documentaire", "Veille concurrentielle"],
    secteurs: ["Transport et logistique"],
    langues: ["français", "anglais", "haoussa"],
    capacite: 100,
    ajustCoutPct: 0,
  },
  "junior.temps.partiel": {
    nom: "Esther Yapi",
    depuis: "2025-11-03",
    type: "interne",
    grade: "junior",
    competences: ["Formation", "Rédaction de livrables", "Gestion de projet"],
    secteurs: ["Assurance", "Distribution"],
    langues: ["français", "anglais", "baoulé"],
    capacite: 60,
    ajustCoutPct: -1,
  },
};

/** Tous les collaborateurs du cabinet, comptes d'abord (ordre de `COMPTES_CABINET`), puis sans compte. */
export const COLLABORATEURS: readonly DefCollaborateur[] = [
  ...COMPTES_CABINET.flatMap((c): DefCollaborateur[] => {
    const profil = PROFILS_COMPTES[c.cle as CleCollaborateur];
    return profil
      ? [{ cle: c.cle as CleCollaborateur, nom: c.nom, depuis: c.depuis, ...profil }]
      : [];
  }),
  ...(
    Object.entries(SANS_COMPTE) as [
      CleCollaborateurSansCompte,
      (typeof SANS_COMPTE)[CleCollaborateurSansCompte],
    ][]
  ).map(([cle, d]) => ({ cle, ...d })),
];

export interface LigneCout {
  depuis_le: string;
  cout_journalier: number | null;
  taux_vente_specifique: number | null;
  cout_achat: number | null;
}

const arrondi500 = (v: number): number => Math.round(v / 500) * 500;

/**
 * Historique de coûts d'un collaborateur : une ligne à l'arrivée, puis une ligne par révision
 * (2025-07-01, 2026-01-01) postérieure à l'arrivée et antérieure au départ éventuel. Les
 * internes ont un coût journalier (grade, écart propre), les externes un coût d'achat ; un
 * profil peut porter un taux de vente propre (révisé comme le reste).
 */
export function historiqueCouts(def: DefCollaborateur): LigneCout[] {
  const base = COUT_JOURNALIER_BASE[def.grade] ?? 0;
  const externe = def.coutAchat !== undefined;
  const depart = def.depart ?? "9999-12-31";
  const versions = [
    { date: def.depuis, facteur: 1 },
    ...REVISIONS_COUTS.filter((r) => r.date > def.depuis && r.date <= depart),
  ];
  return versions.map(({ date, facteur }) => ({
    depuis_le: date,
    cout_journalier: externe
      ? null
      : arrondi500(base * (1 + (def.ajustCoutPct ?? 0) / 100) * facteur),
    taux_vente_specifique: def.tauxVente === undefined ? null : arrondi500(def.tauxVente * facteur),
    cout_achat: externe ? arrondi500((def.coutAchat as number) * facteur) : null,
  }));
}
