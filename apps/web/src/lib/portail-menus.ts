/** Espace client : navigation du portail et droits d'affichage (l'API reste seule juge). */
import { aPermission, TOUS_LES_ROLES, type Permission, type Role } from "@missionpilot/shared";
import type { NomIcone } from "../components/ui/Icone";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "./portail-routes";

// --- Navigation ----------------------------------------------------------------------------

export interface EntreePortail {
  id:
    | "accueil"
    | "missions"
    | "questionnaires"
    | "salle"
    | "kpi"
    | "avancement"
    | "factures"
    | "signatures"
    | "ateliers"
    | "due-diligence"
    | "synthese"
    | "preferences"
    | "securite";
  libelle: string;
  href: string;
  icone: NomIcone;
  /** `null` : tout utilisateur du portail (son propre compte). */
  permission: Permission | null;
}

export const NAVIGATION_PORTAIL: readonly EntreePortail[] = [
  {
    id: "accueil",
    libelle: "Accueil",
    href: CHEMIN_PORTAIL,
    icone: "accueil",
    permission: "portail.acceder",
  },
  {
    id: "missions",
    libelle: "Missions",
    href: `${CHEMIN_PORTAIL}/missions`,
    icone: "dossier",
    permission: "portail.missions.lire",
  },
  {
    // Césure conditionnelle (U+00AD) : le mot se coupe dans la barre basse d'un téléphone étroit.
    id: "questionnaires",
    libelle: "Question\u00adnaires",
    href: `${CHEMIN_PORTAIL}/questionnaires`,
    icone: "taches",
    permission: "portail.questionnaires.repondre",
  },
  {
    // Salle de mission (CLI-01) : pièces demandées par le cabinet, dépôt depuis le téléphone.
    id: "salle",
    libelle: "Documents",
    href: `${CHEMIN_PORTAIL}/salle`,
    icone: "trombone",
    permission: "portail.salle.deposer",
  },
  {
    id: "kpi",
    libelle: "KPI",
    href: `${CHEMIN_PORTAIL}/kpi`,
    icone: "courbe",
    permission: "portail.kpi.saisir",
  },
  {
    // Rapports d'avancement hebdomadaires validés par le cabinet (AUT-10), en lecture seule.
    id: "avancement",
    libelle: "Avancement",
    href: `${CHEMIN_PORTAIL}/avancement`,
    icone: "calendrier",
    permission: "portail.avancement.lire",
  },
  {
    id: "factures",
    libelle: "Factures",
    href: `${CHEMIN_PORTAIL}/factures`,
    icone: "facture",
    permission: "portail.factures.lire",
  },
  {
    // Canaux simulés (lot 3c) : signature simulée d'un PDF de mission (CLI-05).
    id: "signatures",
    libelle: "Signatures",
    href: `${CHEMIN_PORTAIL}/signatures`,
    icone: "signature",
    permission: "portail.signature.signer",
  },
  {
    // Ateliers stratégiques (PLA-15, lot 5a) : voter, classer, noter ; le dirigeant invité seul.
    id: "ateliers",
    libelle: "Ateliers",
    href: `${CHEMIN_PORTAIL}/ateliers`,
    icone: "personnes",
    permission: "portail.ateliers.participer",
  },
  {
    // Notes de due diligence communiquées par le cabinet à l'investisseur (lecture seule).
    id: "due-diligence",
    libelle: "Due diligence",
    href: `${CHEMIN_PORTAIL}/due-diligence`,
    icone: "livre",
    permission: "portail.dd.lire",
  },
  {
    // Synthèse hebdomadaire du dirigeant (CLI-07) : deux nombres et des liens, sans montant.
    id: "synthese",
    libelle: "Synthèse",
    href: `${CHEMIN_PORTAIL}/synthese`,
    icone: "barres",
    permission: "portail.synthese.lire",
  },
  {
    // Préférences de messagerie et consentement (CLI-02) : WhatsApp et SMS simulés.
    id: "preferences",
    libelle: "Messages",
    href: `${CHEMIN_PORTAIL}/preferences`,
    icone: "bulle",
    permission: "portail.canaux.gerer",
  },
  {
    id: "securite",
    libelle: "Sécurité",
    href: CHEMIN_SECURITE_PORTAIL,
    icone: "cadenas",
    permission: null,
  },
];

/** Rôles connus de cette version du web (un rôle inconnu ne donne rien). */
function rolesConnus(roles: readonly string[]): Role[] {
  return roles.filter((r): r is Role => (TOUS_LES_ROLES as readonly string[]).includes(r));
}

/** L'utilisateur détient-il cette permission du portail ? (rôle inconnu : non) */
export function peut(roles: readonly string[], permission: Permission): boolean {
  return aPermission(rolesConnus(roles), permission);
}

/** Entrées de navigation accessibles avec ces rôles. */
export function entreesPortail(roles: readonly string[]): EntreePortail[] {
  return NAVIGATION_PORTAIL.filter((e) => e.permission === null || peut(roles, e.permission));
}

/** Entrée active : l'accueil sur son chemin exact, les autres sur leur préfixe. */
export function entreeActive(chemin: string, entree: Pick<EntreePortail, "href">): boolean {
  if (entree.href === CHEMIN_PORTAIL) return chemin === CHEMIN_PORTAIL;
  return chemin === entree.href || chemin.startsWith(`${entree.href}/`);
}
