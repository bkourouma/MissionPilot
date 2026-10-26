/*
 * Données de la veille d'appels d'offres du Tenant démo (SIMULÉE : aucun réseau, URL en `.invalid`).
 *
 * - `AO_ISSUS_DE_VEILLE` : les appels d'offres de la banque détectés par la veille (fiche créée à
 *   partir d'un résultat retenu) ; les autres ont été saisis à la main par le cabinet.
 * - `AVIS_INDEPENDANTS` : avis de veille sans lien avec la banque (retenus, écartés avec motif,
 *   réexaminé, nouveaux), avec leur parcours de décisions daté.
 */

export interface SourceAoVeille {
  code: string;
  libelle: string;
}

export const SOURCE_PORTAIL: SourceAoVeille = {
  code: "sim_marches_publics",
  libelle: "Portail des marchés publics (simulé)",
};
export const SOURCE_BAILLEURS: SourceAoVeille = {
  code: "sim_bailleurs",
  libelle: "Bailleurs internationaux (simulé)",
};
export const SOURCE_PRESSE: SourceAoVeille = {
  code: "sim_presse",
  libelle: "Presse économique (simulée)",
};
export const SOURCE_SAISIE: SourceAoVeille = { code: "saisie", libelle: "Saisie manuelle" };

/** Jour d'activation des sources (journal du cabinet : veille mise en place fin 2024). */
export const JOUR_ACTIVATION_VEILLE = "2024-11-12";

/** Appels d'offres de la banque repérés par la veille : source, jour de collecte, retenue puis fiche. */
export const AO_ISSUS_DE_VEILLE: Record<
  string,
  { source: SourceAoVeille; jourVu: string; retenuLe: string; ficheLe: string }
> = {
  "mboa-dd": {
    source: SOURCE_BAILLEURS,
    jourVu: "2025-06-17",
    retenuLe: "2025-06-17",
    ficheLe: "2025-06-18",
  },
  "gouvernance-publique": {
    source: SOURCE_PORTAIL,
    jourVu: "2026-01-13",
    retenuLe: "2026-01-13",
    ficheLe: "2026-01-14",
  },
  "baobab-plan": {
    source: SOURCE_PORTAIL,
    jourVu: "2026-03-10",
    retenuLe: "2026-03-10",
    ficheLe: "2026-03-11",
  },
};

/** Parcours de décisions d'un avis indépendant (états attendus : voir `ao-veille.ts`). */
export interface DecisionAvis {
  decision: "retenir" | "ecarter" | "reexaminer";
  jour: string;
  auteur: "associe" | "associe.2" | "directeur.mission" | "chef.mission" | "chef.mission.2";
  motif: string | null;
}

export interface AvisIndependant {
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
  mots_cles: string[];
  source: SourceAoVeille;
  jourVu: string;
  /** Jours où l'avis est revu par une autre source (occurrences supplémentaires). */
  revus: { source: SourceAoVeille; jour: string }[];
  decisions: DecisionAvis[];
}

export const AVIS_INDEPENDANTS: readonly AvisIndependant[] = [
  {
    reference: "AVIS-2024-ML-031",
    titre: "Audit organisationnel d'une coopérative cotonnière",
    objet: "Audit organisationnel et plan de redressement d'une union de coopératives cotonnières.",
    bailleur: "Union des Coopératives Cotonnières du Mali",
    pays: "ML",
    secteur: "Agriculture",
    montant_estime: 31_000_000,
    devise: "XOF",
    date_publication: "2024-11-18",
    date_limite: "2024-12-20",
    mots_cles: ["audit organisationnel", "coopérative", "coton"],
    source: SOURCE_PORTAIL,
    jourVu: "2024-11-19",
    revus: [{ source: SOURCE_PRESSE, jour: "2024-11-25" }],
    decisions: [
      {
        decision: "ecarter",
        jour: "2024-11-21",
        auteur: "directeur.mission",
        motif: "Zone d'intervention trop éloignée de nos équipes, aucune référence malienne.",
      },
    ],
  },
  {
    reference: "AVIS-2025-CI-044",
    titre: "Évaluation à mi-parcours d'un programme d'appui aux PME ivoiriennes",
    objet:
      "Évaluation à mi-parcours, enseignements et recommandations d'un programme de financement.",
    bailleur: "Agence de Développement des PME de Côte d'Ivoire",
    pays: "CI",
    secteur: "Appui aux PME",
    montant_estime: 24_000_000,
    devise: "XOF",
    date_publication: "2025-04-07",
    date_limite: "2025-05-09",
    mots_cles: ["évaluation", "PME", "programme"],
    source: SOURCE_BAILLEURS,
    jourVu: "2025-04-08",
    revus: [],
    decisions: [
      {
        decision: "ecarter",
        jour: "2025-04-10",
        auteur: "chef.mission",
        motif:
          "Évaluation de programme hors de notre offre : nous ne tenons pas de dispositif de suivi-évaluation.",
      },
      {
        decision: "reexaminer",
        jour: "2025-04-22",
        auteur: "associe",
        motif:
          "Réexamen demandé par l'associée : le volet financement des PME relève de notre expertise.",
      },
      {
        decision: "ecarter",
        jour: "2025-04-23",
        auteur: "associe",
        motif:
          "Après réexamen, délai trop court pour constituer l'équipe : avis définitivement écarté.",
      },
    ],
  },
  {
    reference: "AVIS-2025-TG-017",
    titre: "Schéma directeur de transformation digitale d'une banque régionale",
    objet: "Schéma directeur numérique, feuille de route et conduite du changement.",
    bailleur: "Banque Ouest-Africaine de Développement",
    pays: "TG",
    secteur: "Banque et finance",
    montant_estime: 68_000_000,
    devise: "XOF",
    date_publication: "2025-09-15",
    date_limite: "2025-10-24",
    mots_cles: ["transformation digitale", "banque", "plan stratégique"],
    source: SOURCE_PRESSE,
    jourVu: "2025-09-16",
    revus: [{ source: SOURCE_PORTAIL, jour: "2025-09-18" }],
    decisions: [
      {
        decision: "retenir",
        jour: "2025-09-19",
        auteur: "chef.mission.2",
        motif: "Secteur bancaire à développer après l'étude sur le financement des PME agricoles.",
      },
      {
        decision: "ecarter",
        jour: "2025-09-30",
        auteur: "associe.2",
        motif:
          "Expertise informatique requise que le cabinet n'a pas ; pas de partenaire identifié.",
      },
    ],
  },
  {
    reference: "AVIS-2026-SN-006",
    titre: "Élaboration du plan stratégique d'un port autonome",
    objet:
      "Plan stratégique 2027-2031, modèle financier et tableau de bord de la direction générale.",
    bailleur: "Port Autonome de Ziguinchor",
    pays: "SN",
    secteur: "Transport et logistique",
    montant_estime: 52_000_000,
    devise: "XOF",
    date_publication: "2026-06-22",
    date_limite: "2026-08-14",
    mots_cles: ["plan stratégique", "port", "modèle financier"],
    source: SOURCE_PORTAIL,
    jourVu: "2026-06-23",
    revus: [{ source: SOURCE_BAILLEURS, jour: "2026-06-29" }],
    decisions: [
      {
        decision: "ecarter",
        jour: "2026-06-25",
        auteur: "chef.mission",
        motif: "Calendrier incompatible avec la charge de l'été ; avis classé sans suite.",
      },
      {
        decision: "reexaminer",
        jour: "2026-07-06",
        auteur: "associe",
        motif: "Nouvelle disponibilité de l'équipe plan stratégique à partir de mi-juillet.",
      },
      {
        decision: "retenir",
        jour: "2026-07-08",
        auteur: "associe",
        motif: "Retenu : le cabinet a désormais la capacité de répondre avant le 14 août.",
      },
    ],
  },
  {
    reference: "AVIS-2026-CM-052",
    titre: "Appui à la mise en place d'un dispositif de contrôle interne dans un office public",
    objet:
      "Cartographie des risques, procédures et dispositif de contrôle interne d'un office public.",
    bailleur: "Office National des Marchés Agricoles du Cameroun",
    pays: "CM",
    secteur: "Secteur public",
    montant_estime: 29_000_000,
    devise: "XAF",
    date_publication: "2026-09-21",
    date_limite: "2026-11-06",
    mots_cles: ["contrôle interne", "cartographie des risques", "procédures"],
    source: SOURCE_SAISIE,
    jourVu: "2026-09-22",
    revus: [],
    decisions: [],
  },
];
