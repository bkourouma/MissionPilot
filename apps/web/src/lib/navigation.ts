import { aPermission, type Permission, type Role } from "@missionpilot/shared";
import type { NomIcone } from "../components/ui/Icone";

/**
 * Table unique de la navigation. Une entrée `disponible: false` est affichée désactivée
 * (aria-disabled) au lieu de pointer vers une page absente : passer `disponible` à `true`
 * quand l'écran existe.
 */
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
    disponible: false,
    icone: "immeuble",
    description: "Annuaire des clients et de leurs contacts.",
  },
  {
    id: "catalogue",
    libelle: "Catalogue",
    href: "/catalogue",
    permission: "catalogue.lire",
    disponible: false,
    icone: "livre",
    description: "Types de missions, découpages et jours par grade.",
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
    disponible: false,
    icone: "reglages",
    description: "Cabinet, utilisateurs, invitations et référentiels.",
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
