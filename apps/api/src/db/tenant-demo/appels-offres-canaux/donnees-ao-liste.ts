import type { CleMissionCasting } from "./outils.js";

/*
 * Liste de référence des 7 appels d'offres de la banque d'AO du Tenant démo (octobre 2024 →
 * 2026-10-24). CONTRAT PARTAGÉ : les modules des fiches, de la veille et de la banque d'AO
 * retrouvent chaque appel d'offres par sa `reference` (clé naturelle d'idempotence). Organismes
 * et références FICTIFS. Montants en unités de la devise ; dates ISO de l'horloge fictive.
 */

export type IssueAo = "gagne" | "perdu" | "abandonne" | "en_cours";

export interface AppelOffresDemo {
  cle: string;
  reference: string;
  titre: string;
  objet: string;
  bailleur: string;
  pays: string;
  secteur: string;
  montant_estime: number;
  devise: "XOF" | "XAF" | "EUR";
  date_publication: string;
  date_limite: string;
  issue: IssueAo;
  /** Date (ISO) de la décision finale : gagné, perdu ou abandonné. Absente pour l'appel en cours. */
  date_issue: string | null;
  /** Mission du casting obtenue grâce à cet appel d'offres (issue « gagne »). */
  mission: CleMissionCasting | null;
  /** Mots-clés de la fiche. */
  mots_cles: readonly string[];
}

export const APPELS_OFFRES_DEMO: readonly AppelOffresDemo[] = [
  {
    cle: "sicafe-plan",
    reference: "AO-2024-CI-014",
    titre: "Élaboration du plan stratégique 2025-2028 d'un groupe agro-industriel",
    objet:
      "Assistance à la définition de la vision, de la cascade d'objectifs et du plan d'action 2025-2028 " +
      "d'un groupe agro-industriel ivoirien (holding et deux filiales).",
    bailleur: "Groupe SICAFE",
    pays: "CI",
    secteur: "Agro-industrie",
    montant_estime: 62_000_000,
    devise: "XOF",
    date_publication: "2024-10-02",
    date_limite: "2024-10-14",
    issue: "gagne",
    date_issue: "2024-10-25",
    mission: "planSicafe",
    mots_cles: ["plan stratégique", "agro-industrie", "cascade d'objectifs"],
  },
  {
    cle: "banque-pme-etude",
    reference: "AO-2025-SN-003",
    titre: "Étude de positionnement du financement des PME agricoles",
    objet:
      "Étude de marché et recommandations de produits de financement pour les PME de la filière " +
      "agricole sénégalaise, à l'attention d'une banque de développement régionale.",
    bailleur: "Banque de Développement des Économies Sahéliennes",
    pays: "SN",
    secteur: "Banque et finance",
    montant_estime: 48_000_000,
    devise: "XOF",
    date_publication: "2025-01-13",
    date_limite: "2025-02-07",
    issue: "perdu",
    date_issue: "2025-03-04",
    mission: null,
    mots_cles: ["étude de marché", "financement PME", "banque de développement"],
  },
  {
    cle: "mboa-dd",
    reference: "AO-2025-CM-021",
    titre: "Due diligence financière et opérationnelle d'un opérateur solaire",
    objet:
      "Revue de due diligence (financière, opérationnelle, contractuelle) d'un opérateur camerounais " +
      "de solutions solaires dans le cadre d'une entrée au capital.",
    bailleur: "Fonds d'Investissement Énergies Renouvelables d'Afrique Centrale",
    pays: "CM",
    secteur: "Énergie",
    montant_estime: 38_000_000,
    devise: "XAF",
    date_publication: "2025-06-16",
    date_limite: "2025-07-11",
    issue: "gagne",
    date_issue: "2025-08-05",
    mission: "ddMboa",
    mots_cles: ["due diligence", "énergie solaire", "investisseur"],
  },
  {
    cle: "retail-abandon",
    reference: "AO-2025-BF-009",
    titre: "Appui à la structuration d'une centrale d'achats de distribution",
    objet:
      "Mission d'appui à la création d'une centrale d'achats pour un réseau de distributeurs burkinabè " +
      "(cahier des charges, gouvernance, business plan).",
    bailleur: "Association des Distributeurs du Faso",
    pays: "BF",
    secteur: "Distribution",
    montant_estime: 27_000_000,
    devise: "XOF",
    date_publication: "2025-10-06",
    date_limite: "2025-11-07",
    issue: "abandonne",
    date_issue: "2025-10-24",
    mission: null,
    mots_cles: ["centrale d'achats", "distribution", "gouvernance"],
  },
  {
    cle: "gouvernance-publique",
    reference: "AO-2026-GA-002",
    titre: "Diagnostic de la performance de la gestion des investissements publics",
    objet:
      "Diagnostic organisationnel et plan de renforcement de la fonction de programmation des " +
      "investissements d'un ministère gabonais.",
    bailleur: "Direction Générale du Budget et des Finances Publiques",
    pays: "GA",
    secteur: "Secteur public",
    montant_estime: 55_000_000,
    devise: "XAF",
    date_publication: "2026-01-12",
    date_limite: "2026-02-13",
    issue: "perdu",
    date_issue: "2026-03-10",
    mission: null,
    mots_cles: ["diagnostic organisationnel", "finances publiques", "investissement public"],
  },
  {
    cle: "baobab-plan",
    reference: "AO-2026-SN-011",
    titre: "Plan stratégique 2026-2030 d'une compagnie d'assurances",
    objet:
      "Élaboration du plan stratégique 2026-2030, du modèle financier et du tableau de bord de pilotage " +
      "d'une compagnie d'assurances multi-pays de la zone UEMOA.",
    bailleur: "Baobab Assurances",
    pays: "SN",
    secteur: "Assurance",
    montant_estime: 74_000_000,
    devise: "XOF",
    date_publication: "2026-03-09",
    date_limite: "2026-04-10",
    issue: "gagne",
    date_issue: "2026-05-12",
    mission: "planBaobab",
    mots_cles: ["plan stratégique", "assurance", "modèle financier", "UEMOA"],
  },
  {
    cle: "cemac-formation",
    reference: "AO-2026-CM-018",
    titre: "Programme de renforcement des capacités des PME exportatrices",
    objet:
      "Conception et animation d'un programme d'accompagnement de 40 PME exportatrices de la zone " +
      "CEMAC (diagnostics flash, formations, suivi).",
    bailleur: "Programme Régional d'Appui à l'Export (CEMAC)",
    pays: "CM",
    secteur: "Appui aux PME",
    montant_estime: 85_000_000,
    devise: "XAF",
    date_publication: "2026-10-06",
    date_limite: "2026-11-13",
    issue: "en_cours",
    date_issue: null,
    mission: null,
    mots_cles: ["PME", "export", "renforcement des capacités", "CEMAC"],
  },
];
