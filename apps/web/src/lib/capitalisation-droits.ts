import { aPermission, type Permission, type Role } from "@missionpilot/shared";

/** Sous-pages de la rubrique « Connaissances » et droits d'affichage. */

/* ----- Sous-pages et droits ----- */

export interface SousPageConnaissances {
  id: string;
  libelle: string;
  href: string;
  permission: Permission;
  /** Seconde permission exigée en plus (l'estimation donne des jours : `budget.lire_jours`). */
  aussi?: Permission;
}

export const SOUS_PAGES_CONNAISSANCES: readonly SousPageConnaissances[] = [
  {
    id: "recherche",
    libelle: "Recherche",
    href: "/connaissances",
    permission: "connaissance.lire",
  },
  {
    id: "retours",
    libelle: "Retours d'expérience",
    href: "/connaissances/retours",
    permission: "connaissance.lire",
  },
  {
    id: "estimation",
    libelle: "Estimation",
    href: "/connaissances/estimation",
    permission: "connaissance.lire",
    aussi: "budget.lire_jours",
  },
  {
    id: "efficacite",
    libelle: "Efficacité",
    href: "/connaissances/efficacite",
    permission: "connaissance.lire",
  },
  {
    id: "competences",
    libelle: "Compétences",
    href: "/connaissances/competences",
    permission: "temps.saisir",
  },
  {
    id: "derogations",
    libelle: "Évolutions du standard",
    href: "/connaissances/derogations",
    permission: "standard.gerer",
  },
];

/**
 * Permissions dont l'une ouvre la rubrique : celles de ses sous-pages. `temps.saisir` ouvre
 * « Compétences » (ses propres niveaux, `/competences/moi`) à tout rôle qui saisit des temps ;
 * la rubrique n'est PAS ouverte par `collaborateurs.lire` (la matrice de tous exige
 * `competence.lire`). Même liste que l'entrée « Connaissances » de `navigation.ts`.
 */
export const PERMISSIONS_RUBRIQUE: readonly Permission[] = [
  "connaissance.lire",
  "temps.saisir",
  "competence.lire",
  "competence.gerer",
  "standard.gerer",
];

export function sousPagesConnaissances(roles: readonly Role[]): SousPageConnaissances[] {
  return SOUS_PAGES_CONNAISSANCES.filter(
    (p) => aPermission(roles, p.permission) && (!p.aussi || aPermission(roles, p.aussi)),
  );
}

/** Droits d'affichage (l'API reste la source de vérité). */
export function droitsConnaissances(roles: readonly Role[]) {
  return {
    lire: aPermission(roles, "connaissance.lire"),
    rediger: aPermission(roles, "mission.planifier"),
    ia: aPermission(roles, "ia.utiliser"),
    matrice: aPermission(roles, "competence.lire"),
    /** Jours et preuves d'usage de la matrice : en plus, `budget.lire_jours` (FIN-02). */
    matriceJours: aPermission(roles, "competence.lire") && aPermission(roles, "budget.lire_jours"),
    gererCompetences: aPermission(roles, "competence.gerer"),
    comiteMethode: aPermission(roles, "standard.gerer"),
  };
}
