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
  permission: Permission;
}

export interface EntreeNavigation {
  id: string;
  libelle: string;
  /** Libellé de la barre basse du téléphone, si `libelle` est trop long. */
  libelleCourt?: string;
  href: string;
  /** `null` : visible de tout utilisateur connecté. */
  permission: Permission | null;
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
    disponible: false,
    icone: "calendrier",
    description: "Vos tâches et affectations de la semaine.",
  },
  {
    id: "feuille-de-temps",
    libelle: "Feuille de temps",
    libelleCourt: "Temps",
    href: "/temps",
    permission: "temps.saisir",
    disponible: false,
    icone: "horloge",
    description: "Saisie des jours par tâche, reste à faire et débours.",
  },
  {
    id: "missions",
    libelle: "Missions",
    href: "/missions",
    permission: "mission.lire",
    disponible: false,
    icone: "dossier",
    description: "Fiches mission, découpage, budget et avancement.",
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
    id: "plan-de-charge",
    libelle: "Plan de charge",
    libelleCourt: "Charge",
    href: "/charge",
    permission: "charge.lire",
    disponible: false,
    icone: "barres",
    description: "Occupation des équipes, surcharges et disponibilités.",
  },
  {
    id: "facturation",
    libelle: "Facturation",
    href: "/facturation",
    permission: "facture.lire",
    disponible: false,
    icone: "facture",
    description: "Échéanciers, factures, débours et encaissements.",
  },
  {
    id: "indicateurs",
    libelle: "Indicateurs",
    href: "/indicateurs",
    permission: "indicateurs.cabinet",
    disponible: false,
    icone: "courbe",
    description: "Occupation, marge, carnet de commandes et encours du cabinet.",
  },
  {
    id: "parametres",
    libelle: "Paramètres",
    href: "/parametres",
    permission: "cabinet.gerer",
    disponible: true,
    icone: "reglages",
    description: "Cabinet, utilisateurs, invitations et journal d'audit.",
    sousPages: [
      { id: "cabinet", libelle: "Cabinet", href: "/parametres", permission: "cabinet.gerer" },
      {
        id: "utilisateurs",
        libelle: "Utilisateurs",
        href: "/parametres/utilisateurs",
        permission: "cabinet.gerer",
      },
      {
        id: "journal",
        libelle: "Journal d'audit",
        href: "/parametres/journal",
        permission: "audit.lire",
      },
    ],
  },
];

/** Nombre d'entrées dans la barre basse du téléphone (le reste passe dans « Menu »). */
export const ENTREES_BARRE_BASSE = 4;

/** Entrées visibles pour ces rôles, dans l'ordre de la table. */
export function entreesAutorisees(
  roles: readonly Role[],
  table: readonly EntreeNavigation[] = NAVIGATION,
): EntreeNavigation[] {
  return table.filter((e) => e.permission === null || aPermission(roles, e.permission));
}

/** Entrée active pour un chemin : correspondance exacte pour « / », par préfixe sinon. */
export function estActive(entree: Pick<EntreeNavigation, "href">, chemin: string): boolean {
  if (entree.href === "/") return chemin === "/";
  return chemin === entree.href || chemin.startsWith(`${entree.href}/`);
}

/** Sous-pages d'une rubrique visibles pour ces rôles. */
export function sousPagesAutorisees(id: string, roles: readonly Role[]): SousPage[] {
  const entree = NAVIGATION.find((e) => e.id === id);
  return (entree?.sousPages ?? []).filter((p) => aPermission(roles, p.permission));
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
