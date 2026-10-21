import { aPermission, type Permission, type Role } from "@missionpilot/shared";
import type { NomIcone } from "../components/ui/Icone";

/**
 * Table unique de la navigation. Une entrée `disponible: false` est affichée désactivée
 * (aria-disabled) au lieu de pointer vers une page absente : passer `disponible` à `true`
 * quand l'écran existe.
 */
/** Sous-page d'une rubrique, affichée en onglets en tête de la rubrique. */
export interface SousPage {
  id: string;
  libelle: string;
  href: string;
  /** Une permission, ou une liste dont l'une suffit. */
  permission: Permission | readonly Permission[];
}

export interface EntreeNavigation {
  id: string;
  libelle: string;
  /** Libellé de la barre basse du téléphone, si `libelle` est trop long. */
  libelleCourt?: string;
  href: string;
  /**
   * `null` : visible de tout utilisateur connecté ; une liste : visible avec l'une de ces
   * permissions (rubrique dont les sous-pages relèvent de droits différents).
   */
  permission: Permission | readonly Permission[] | null;
  disponible: boolean;
  icone: NomIcone;
  /** Ce que l'écran permettra de faire, affiché sur le tableau de bord. */
  description: string;
  sousPages?: readonly SousPage[];
}

export const NAVIGATION: readonly EntreeNavigation[] = [
  {
    id: "tableau-de-bord",
    libelle: "Tableau de bord",
    libelleCourt: "Accueil",
    href: "/",
    permission: null,
    disponible: true,
    icone: "accueil",
    description: "Vue d'ensemble et accès à vos modules.",
  },
  {
    id: "mon-planning",
    libelle: "Mon planning",
    libelleCourt: "Planning",
    href: "/planning",
    permission: "temps.saisir",
    disponible: true,
    icone: "calendrier",
    description: "Vos tâches, jours alloués, absences et jours fériés de la semaine ; vos congés.",
    sousPages: [
      { id: "semaine", libelle: "Ma semaine", href: "/planning", permission: "temps.saisir" },
      {
        id: "conges",
        libelle: "Mes congés",
        href: "/planning/conges",
        permission: "conges.demander",
      },
      {
        id: "conges-validation",
        libelle: "Congés à valider",
        href: "/planning/conges/validation",
        permission: "conges.valider",
      },
    ],
  },
  {
    id: "feuille-de-temps",
    libelle: "Feuille de temps",
    libelleCourt: "Temps",
    href: "/temps",
    permission: "temps.saisir",
    disponible: true,
    icone: "horloge",
    description:
      "Saisie hebdomadaire par tâche, reste à faire, débours et notes de frais, validation et corrections.",
    sousPages: [
      { id: "feuille", libelle: "Ma feuille", href: "/temps", permission: "temps.saisir" },
      {
        id: "validation",
        libelle: "À valider",
        href: "/temps/validation",
        permission: "temps.valider",
      },
      {
        id: "corrections",
        libelle: "Corrections",
        href: "/temps/corrections",
        permission: "temps.saisir",
      },
      {
        id: "discipline",
        libelle: "Discipline de saisie",
        href: "/temps/discipline",
        permission: "temps.saisir",
      },
      {
        id: "debours",
        libelle: "Mes débours",
        href: "/temps/debours",
        permission: "debours.saisir",
      },
    ],
  },
  {
    id: "missions",
    libelle: "Missions",
    href: "/missions",
    permission: "mission.lire",
    disponible: true,
    icone: "dossier",
    description: "Fiches mission, découpage, planning et versions de budget.",
  },
  {
    id: "mes-taches",
    libelle: "Mes tâches",
    libelleCourt: "Tâches",
    href: "/mes-taches",
    // Tout utilisateur connecté peut se voir assigner une tâche (SOC-08).
    permission: null,
    disponible: true,
    icone: "taches",
    description:
      "Les tâches qui vous sont assignées et celles que vous avez confiées, avec leur échéance.",
  },
  {
    // Brief quotidien (AUT-07, vague 2) : ce qui demande l'attention de l'utilisateur, selon son rôle.
    id: "mon-brief",
    libelle: "Mon brief",
    libelleCourt: "Brief",
    href: "/brief",
    permission: "brief.lire",
    disponible: true,
    icone: "cloche",
    description: "Votre brief du jour : ce qui demande votre attention, selon votre rôle.",
  },
  {
    // Copilote conversationnel (AGT-08, vague 2) : questions en français dans les droits de l'utilisateur.
    id: "copilote",
    libelle: "Copilote",
    href: "/copilote",
    permission: "copilote.utiliser",
    disponible: true,
    icone: "bulle",
    description:
      "Posez vos questions en français : réponses dans vos droits, actions proposées que vous confirmez.",
  },
  {
    id: "pipeline",
    libelle: "Pipeline",
    href: "/pipeline",
    permission: "pipeline.gerer",
    disponible: true,
    icone: "entonnoir",
    description: "Opportunités commerciales, propositions et passage en mission.",
  },
  {
    // Lot AO-A (AO-01 à AO-03, AO-08) : pipeline, fiche, go/no-go, matrice, rétro-planning.
    id: "appels-offres",
    libelle: "Appels d'offres",
    libelleCourt: "AO",
    href: "/appels-offres",
    permission: "ao.lire",
    disponible: true,
    icone: "drapeau",
    description:
      "Appels d'offres repérés, go/no-go de l'associé, matrice de conformité et rétro-planning.",
  },
  {
    // Lot AO-B (AO-04 à AO-07) ; sous-pages dans la rubrique (lib/banque-ao.ts).
    id: "banques-ao",
    libelle: "Banques et offres",
    libelleCourt: "Offres",
    href: "/appels-offres/banques",
    permission: "ao.lire",
    disponible: true,
    icone: "copie",
    description:
      "CV et références pour les appels d'offres, offres techniques validées et offres financières.",
  },
  {
    id: "clients",
    libelle: "Clients",
    href: "/clients",
    permission: "clients.lire",
    disponible: true,
    icone: "immeuble",
    description: "Annuaire des clients et de leurs contacts.",
  },
  {
    id: "collaborateurs",
    libelle: "Collaborateurs",
    libelleCourt: "Équipe",
    href: "/collaborateurs",
    permission: "collaborateurs.lire",
    disponible: true,
    icone: "personnes",
    description: "Référentiel de l'équipe : grades, compétences, capacité.",
  },
  {
    id: "catalogue",
    libelle: "Catalogue",
    href: "/catalogue",
    permission: "catalogue.lire",
    disponible: true,
    icone: "livre",
    description: "Types de missions, découpages et jours par grade.",
    sousPages: [
      {
        id: "types",
        libelle: "Types de mission",
        href: "/catalogue",
        permission: "catalogue.lire",
      },
      { id: "grades", libelle: "Grades", href: "/catalogue/grades", permission: "catalogue.lire" },
    ],
  },
  {
    id: "questionnaires",
    libelle: "Questionnaires",
    href: "/questionnaires",
    permission: "questionnaire.lire",
    disponible: true,
    icone: "bulle",
    description:
      "Modèles de questionnaires du cabinet, gabarits génériques, versions validées à envoyer aux clients.",
  },
  {
    id: "notation",
    libelle: "Notation",
    href: "/notation",
    permission: ["notation.gerer", "notation.publier"],
    disponible: true,
    icone: "drapeau",
    description:
      "Grilles de notation du cabinet : pondérations par dimension et par secteur, validation par un expert métier.",
  },
  // Vague 1 (V3) : rubriques déclarées avant leurs écrans, affichées désactivées (aucun lien
  // mort) ; chaque lot passe `disponible` à `true` quand son écran existe.
  {
    id: "methodes",
    libelle: "Méthodes",
    href: "/methodes",
    permission: "standard.lire",
    disponible: true,
    icone: "livre",
    description:
      "Référentiel de méthodes : briques, facteurs de contexte, règles de modulation et dérogations.",
  },
  {
    id: "dossiers-clients",
    libelle: "Dossiers clients",
    libelleCourt: "Dossiers",
    href: "/dossiers",
    permission: "dossier.lire",
    disponible: true,
    icone: "trombone",
    description: "Dossier vivant de chaque client : faits datés et sourcés, finances, frise.",
  },
  {
    // Service #5, lot 3a (RED-01, 02, 05 à 07, 10 à 12, 14) ; le dossier d'une mission est un
    // onglet de la mission (missions/[id]/redressement).
    id: "redressement",
    libelle: "Redressement",
    libelleCourt: "Redressement",
    href: "/redressement",
    permission: "redressement.lire",
    disponible: true,
    icone: "attention",
    description:
      "Redressement : score d'alerte précoce indicatif, trésorerie à 13 semaines, créanciers et plan d'actions.",
    sousPages: [
      {
        id: "dossiers",
        libelle: "Dossiers",
        href: "/redressement",
        permission: "redressement.lire",
      },
      {
        id: "seuils",
        libelle: "Seuils d'alerte",
        href: "/redressement/seuils",
        permission: "redressement.lire",
      },
      {
        id: "checklists",
        libelle: "Check-lists",
        href: "/redressement/checklists",
        permission: "redressement.lire",
      },
      {
        id: "tableau-de-bord",
        libelle: "Tableau de bord",
        href: "/redressement/tableau-de-bord",
        permission: "redressement.lire",
      },
    ],
  },
  {
    id: "agents-ia",
    libelle: "Agents IA",
    libelleCourt: "Agents",
    href: "/agents",
    permission: "agent.lire",
    disponible: true,
    icone: "nuage",
    description: "Équipe d'agents IA : niveaux d'autonomie par brique et contribution mesurée.",
  },
  {
    id: "qualite",
    libelle: "Qualité",
    href: "/qualite",
    permission: "qualite.relire",
    disponible: true,
    icone: "signature",
    description: "Revues guidées, quatre yeux et signature des livrables engageants.",
  },
  {
    // Lot CAP (CAP-01, 02, 05 à 07) ; sous-pages dans la rubrique (lib/capitalisation.ts).
    id: "connaissances",
    libelle: "Connaissances",
    libelleCourt: "Savoirs",
    href: "/connaissances",
    // Liste identique à PERMISSIONS_RUBRIQUE (lib/capitalisation.ts, verrouillée par un test) :
    // chaque onglet a sa permission, `temps.saisir` ouvre « Compétences » (« Mes compétences »).
    permission: [
      "connaissance.lire",
      "temps.saisir",
      "competence.lire",
      "competence.gerer",
      "standard.gerer",
    ],
    disponible: true,
    icone: "recherche",
    description:
      "Recherche unifiée, retours d'expérience des missions, base d'estimation et compétences.",
  },
  {
    id: "plan-de-charge",
    libelle: "Plan de charge",
    libelleCourt: "Charge",
    href: "/charge",
    permission: "charge.lire",
    disponible: true,
    icone: "barres",
    description: "Occupation des équipes, surcharges et disponibilités.",
  },
  {
    id: "previsions",
    libelle: "Prévisions",
    href: "/previsions",
    permission: "finance.lire",
    disponible: true,
    icone: "courbe",
    description:
      "Chiffre d'affaires et charge des 12 prochains mois : carnet signé et pipeline pondéré.",
  },
  {
    id: "facturation",
    libelle: "Facturation",
    href: "/facturation",
    permission: ["facture.lire", "encaissement.gerer"],
    disponible: true,
    icone: "facture",
    description:
      "Factures et avoirs, encaissements et imputations, créances, balance âgée et relances.",
    sousPages: [
      { id: "factures", libelle: "Factures", href: "/facturation", permission: "facture.lire" },
      {
        id: "encaissements",
        libelle: "Encaissements",
        href: "/facturation/encaissements",
        permission: "encaissement.gerer",
      },
      {
        id: "creances",
        libelle: "Créances",
        href: "/facturation/creances",
        permission: ["encaissement.gerer", "indicateurs.cabinet"],
      },
    ],
  },
  {
    id: "finance",
    libelle: "Finance",
    href: "/finance",
    permission: ["facture.lire", "indicateurs.cabinet", "finance.lire", "export.comptable"],
    disponible: true,
    icone: "monnaie",
    description: "Encours de production, rentabilité des missions et export comptable.",
    sousPages: [
      {
        id: "encours",
        libelle: "Encours de production",
        href: "/finance/encours",
        permission: ["facture.lire", "indicateurs.cabinet"],
      },
      {
        id: "rentabilite",
        libelle: "Rentabilité",
        href: "/finance/rentabilite",
        permission: "finance.lire",
      },
      {
        id: "export",
        libelle: "Export comptable",
        href: "/finance/export",
        permission: "export.comptable",
      },
    ],
  },
  {
    id: "indicateurs",
    libelle: "Indicateurs",
    href: "/indicateurs",
    permission: "indicateurs.cabinet",
    disponible: true,
    icone: "courbe",
    description:
      "Les onze indicateurs de pilotage : occupation, marge, encours, carnet de commandes, dérives.",
  },
  {
    id: "parametres",
    libelle: "Paramètres",
    href: "/parametres",
    permission: [
      "cabinet.gerer",
      "facture.emettre",
      "temps.cloturer",
      "temps.importer",
      "canaux.lire",
      "dd.referentiel.gerer",
    ],
    disponible: true,
    icone: "reglages",
    description:
      "Cabinet, utilisateurs, sécurité, canaux de messagerie simulés, temps, facturation, clôture mensuelle, import, due diligence et journal d'audit.",
    sousPages: [
      { id: "cabinet", libelle: "Cabinet", href: "/parametres", permission: "cabinet.gerer" },
      {
        id: "utilisateurs",
        libelle: "Utilisateurs",
        href: "/parametres/utilisateurs",
        permission: "cabinet.gerer",
      },
      {
        id: "securite",
        libelle: "Sécurité",
        href: "/parametres/securite",
        permission: "cabinet.gerer",
      },
      {
        id: "portail",
        libelle: "Portail client",
        href: "/parametres/portail",
        permission: "cabinet.gerer",
      },
      {
        // Canaux externes SIMULÉS (lot 3c) : comptes, consentements, journal des envois.
        id: "canaux",
        libelle: "Canaux",
        href: "/parametres/canaux",
        permission: "canaux.lire",
      },
      { id: "temps", libelle: "Temps", href: "/parametres/temps", permission: "cabinet.gerer" },
      {
        id: "facturation",
        libelle: "Facturation",
        href: "/parametres/facturation",
        permission: "facture.emettre",
      },
      {
        id: "cloture",
        libelle: "Clôture des temps",
        href: "/parametres/cloture",
        permission: "temps.cloturer",
      },
      {
        id: "cloture-mission",
        libelle: "Clôture de mission",
        href: "/parametres/cloture-mission",
        permission: "cabinet.gerer",
      },
      {
        id: "import",
        libelle: "Import des temps",
        href: "/parametres/import-temps",
        permission: "temps.importer",
      },
      {
        id: "notation",
        libelle: "Notation",
        href: "/parametres/notation",
        permission: "cabinet.gerer",
      },
      {
        // Vague 4, service #2 (SPEC-3b §10.1) : bibliothèque de signaux et listes d'exclusion.
        id: "due-diligence",
        libelle: "Due diligence",
        href: "/parametres/due-diligence",
        permission: "dd.referentiel.gerer",
      },
      {
        id: "journal",
        libelle: "Journal d'audit",
        href: "/parametres/journal",
        permission: "audit.lire",
      },
      { id: "ia", libelle: "IA", href: "/parametres/ia", permission: "ia.configurer" },
    ],
  },
];

/** Onglet de mission ajouté par les canaux simulés (lot 3c). */
export interface OngletMissionCanaux {
  id: "signatures" | "transcriptions";
  libelle: string;
  href: string;
}

/**
 * Onglets de mission « Signatures » (`signature.lire`) et « Transcriptions » (`transcription.lire`),
 * à insérer dans la mise en page de la mission (`base` : `/missions/<id>`).
 */
export function ongletsMissionCanaux(roles: readonly Role[], base: string): OngletMissionCanaux[] {
  return [
    ...(aPermission(roles, "signature.lire")
      ? [{ id: "signatures" as const, libelle: "Signatures", href: `${base}/signatures` }]
      : []),
    ...(aPermission(roles, "transcription.lire")
      ? [
          {
            id: "transcriptions" as const,
            libelle: "Transcriptions",
            href: `${base}/transcriptions`,
          },
        ]
      : []),
  ];
}

/** Sécurité de son propre compte (double authentification) : tout utilisateur connecté. */
export const CHEMIN_SECURITE_COMPTE = "/compte/securite";

/** Nombre d'entrées dans la barre basse du téléphone (le reste passe dans « Menu »). */
export const ENTREES_BARRE_BASSE = 4;

/**
 * Entrées de la barre basse du téléphone : les premières entrées disponibles (un écran pas
 * encore livré n'occupe pas une place précieuse), le reste passe dans « Menu ».
 */
export function entreesBarreBasse(
  entrees: readonly EntreeNavigation[],
  nombre: number = ENTREES_BARRE_BASSE,
): EntreeNavigation[] {
  return entrees.filter((e) => e.disponible).slice(0, nombre);
}

/** Entrées visibles pour ces rôles, dans l'ordre de la table. */
export function entreesAutorisees(
  roles: readonly Role[],
  table: readonly EntreeNavigation[] = NAVIGATION,
): EntreeNavigation[] {
  return table.filter((e) => autorise(roles, e.permission));
}

/** `null` : tout utilisateur ; liste : l'une des permissions suffit. */
export function autorise(
  roles: readonly Role[],
  permission: EntreeNavigation["permission"],
): boolean {
  if (permission === null) return true;
  if (typeof permission === "string") return aPermission(roles, permission);
  return permission.some((p) => aPermission(roles, p));
}

/** Entrée active pour un chemin : correspondance exacte pour « / », par préfixe sinon. */
export function estActive(entree: Pick<EntreeNavigation, "href">, chemin: string): boolean {
  if (entree.href === "/") return chemin === "/";
  return chemin === entree.href || chemin.startsWith(`${entree.href}/`);
}

/** Sous-pages d'une rubrique visibles pour ces rôles. */
export function sousPagesAutorisees(id: string, roles: readonly Role[]): SousPage[] {
  const entree = NAVIGATION.find((e) => e.id === id);
  return (entree?.sousPages ?? []).filter((p) => autorise(roles, p.permission));
}

/** Sous-page active : celle dont le chemin est le plus long préfixe du chemin courant. */
export function sousPageActive(
  pages: readonly Pick<SousPage, "id" | "href">[],
  chemin: string,
): string | null {
  let meilleure: Pick<SousPage, "id" | "href"> | null = null;
  for (const p of pages) {
    if (!estActive(p, chemin)) continue;
    if (!meilleure || p.href.length > meilleure.href.length) meilleure = p;
  }
  return meilleure?.id ?? null;
}
