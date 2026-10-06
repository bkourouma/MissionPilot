import { z } from "zod";

/** Rôles côté cabinet (SOC-02). Les rôles client (portail) arrivent en V2. */
export const ROLES = [
  "associe",
  "directeur_mission",
  "chef_mission",
  "consultant",
  "ressources",
  "gestionnaire",
  "expert_metier",
  "expert_externe",
] as const;

export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export const ROLE_LIBELLES: Record<Role, string> = {
  associe: "Associé",
  directeur_mission: "Directeur de mission",
  chef_mission: "Chef de mission",
  consultant: "Consultant",
  ressources: "Responsable des ressources",
  gestionnaire: "Gestionnaire administratif et financier",
  expert_metier: "Expert métier",
  expert_externe: "Expert externe",
};

/** Droits fins, nommés par capacité plutôt que par écran. */
export const PERMISSIONS = [
  "cabinet.gerer", // paramètres du cabinet, utilisateurs, invitations
  "audit.lire",
  "clients.lire",
  "clients.ecrire",
  "collaborateurs.lire", // référentiel des collaborateurs, sans aucune donnée financière
  "collaborateurs.ecrire",
  "catalogue.lire",
  "catalogue.ecrire",
  "pipeline.gerer",
  "proposition.valider",
  "mission.lire",
  "mission.creer",
  "mission.planifier",
  "budget.lire_jours",
  "budget.ecrire",
  "budget.reviser", // valider une révision (directeur de mission)
  "finance.lire", // coûts journaliers, taux, marges (FIN-02) : associés et gestionnaires
  "taux.gerer",
  "affectation.gerer",
  "charge.lire",
  "conges.valider",
  "temps.saisir",
  "temps.valider",
  "temps.cloturer",
  "facture.lire",
  "facture.emettre",
  "facture.valider",
  "encaissement.gerer",
  "indicateurs.cabinet",
  "mission.lire_toutes", // toutes les missions du cabinet (sinon : les siennes et celles de son équipe)
  "mission.modifier_toutes", // modifier toute mission du cabinet (sinon : celles dont on est directeur ou chef)
  "mission.signer", // signer la lettre de mission : fige le budget initial (MIS-07)
  "mission.cloturer",
  "budget.lire_montants", // honoraires et débours du budget (sans coûts internes ni marges)
  "document.ecrire", // documents de mission (SOC-05)
  "conges.demander", // demander un congé ou une absence pour soi (PLN-07)
  "temps.importer", // importer l'historique des temps (TPS-10)
  "debours.saisir", // déclarer ses débours et notes de frais (FIN-05)
  "debours.valider", // valider les débours d'une mission dont on est chef ou directeur (FIN-05)
  "export.comptable", // exporter les écritures comptables et régler le plan comptable (FIN-13)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const TOUS: readonly Permission[] = PERMISSIONS;

export const PERMISSIONS_PAR_ROLE: Record<Role, readonly Permission[]> = {
  associe: TOUS,
  directeur_mission: [
    "clients.lire",
    "clients.ecrire",
    "collaborateurs.lire",
    "catalogue.lire",
    "pipeline.gerer",
    // Pas de « proposition.valider » : une proposition est validée par un associé (PRD, MIS-05).
    "mission.lire",
    "mission.creer",
    "mission.planifier",
    "budget.lire_jours",
    "budget.ecrire",
    "budget.reviser",
    "affectation.gerer",
    "charge.lire",
    "temps.saisir",
    "temps.valider",
    "facture.lire",
    "facture.valider",
    "indicateurs.cabinet",
    "mission.lire_toutes",
    "mission.modifier_toutes",
    "mission.signer",
    "mission.cloturer",
    "budget.lire_montants",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
    "debours.valider",
  ],
  chef_mission: [
    "clients.lire",
    "collaborateurs.lire",
    "catalogue.lire",
    "pipeline.gerer",
    "mission.lire",
    "mission.creer",
    "mission.planifier",
    "budget.lire_jours",
    "budget.ecrire",
    "affectation.gerer",
    "charge.lire",
    "temps.saisir",
    "temps.valider",
    "facture.lire",
    "budget.lire_montants",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
    "debours.valider",
  ],
  consultant: [
    "clients.lire",
    "catalogue.lire",
    "mission.lire",
    "budget.lire_jours",
    "temps.saisir",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
  ],
  ressources: [
    "clients.lire",
    "collaborateurs.lire",
    "collaborateurs.ecrire",
    "catalogue.lire",
    "mission.lire",
    "budget.lire_jours",
    "affectation.gerer",
    "charge.lire",
    "conges.valider",
    "temps.saisir",
    "mission.lire_toutes",
    "conges.demander",
    "debours.saisir",
  ],
  gestionnaire: [
    "clients.lire",
    "clients.ecrire",
    "collaborateurs.lire",
    "collaborateurs.ecrire",
    "catalogue.lire",
    "mission.lire",
    "budget.lire_jours",
    "finance.lire",
    "taux.gerer",
    "facture.lire",
    "facture.emettre",
    "encaissement.gerer",
    "temps.saisir",
    "temps.cloturer",
    "temps.importer",
    "indicateurs.cabinet",
    "charge.lire",
    "mission.lire_toutes",
    "budget.lire_montants",
    "conges.demander",
    "debours.saisir",
    "export.comptable",
  ],
  expert_metier: [
    "catalogue.lire",
    "catalogue.ecrire",
    "mission.lire",
    "temps.saisir",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
  ],
  expert_externe: ["temps.saisir", "debours.saisir"],
};

/** Les associés et gestionnaires seuls voient coûts, taux et marges (FIN-02). */
export function aPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => PERMISSIONS_PAR_ROLE[role].includes(permission));
}
