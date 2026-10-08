import { z } from "zod";

/*
 * Modèle des rôles (SOC-02, SOC-09).
 *
 * Deux familles DISJOINTES (contrainte CHECK en base, migration 0110) :
 * - `ROLES` : rôles du cabinet (les 8 rôles internes). Choix délibéré : la
 *   constante historique reste la liste des rôles INTERNES, de sorte que tout
 *   code qui l'itère (formulaire d'invitation, matrices de droits, schéma
 *   `roleSchema` des invitations et modifications internes) reste interne
 *   par défaut et ne propose jamais un rôle client par mégarde ;
 * - `ROLES_CLIENT` : personnes de l'entreprise cliente invitées sur le portail
 *   (SOC-09). Elles ne détiennent QUE des permissions `portail.*` : lecture
 *   de leur entreprise et, pour le dirigeant et le contributeur, saisie des
 *   KPI et réponses aux questionnaires sur désignation explicite du cabinet ;
 *   l'investisseur est déclaré (lecture, V3) sans écran.
 *
 * Le type `Role` couvre les deux familles (une session porte l'une OU
 * l'autre) ; `TOUS_LES_ROLES` les énumère toutes.
 */

/** Rôles côté cabinet (SOC-02). */
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
/** Alias explicite de `ROLES`. */
export const ROLES_CABINET = ROLES;

/** Rôles des utilisateurs du portail client (SOC-09), jamais cumulables avec un rôle interne. */
export const ROLES_CLIENT = [
  "client_dirigeant",
  "client_contributeur",
  "client_investisseur",
] as const;

export const TOUS_LES_ROLES = [...ROLES, ...ROLES_CLIENT] as const;

export type RoleCabinet = (typeof ROLES)[number];
export type RoleClient = (typeof ROLES_CLIENT)[number];
export type Role = RoleCabinet | RoleClient;

/** Rôle du CABINET (invitations et modifications internes : jamais un rôle client). */
export const roleSchema = z.enum(ROLES);
/** Rôle du portail client (invitations du portail). */
export const roleClientSchema = z.enum(ROLES_CLIENT);
/** Tout rôle connu (lecture d'une session). */
export const roleQuelconqueSchema = z.enum(TOUS_LES_ROLES);

export function estRoleClient(role: string): role is RoleClient {
  return (ROLES_CLIENT as readonly string[]).includes(role);
}

/** Une session portant un rôle client est un utilisateur du portail (liste blanche stricte). */
export function estUtilisateurPortail(roles: readonly string[]): boolean {
  return roles.some(estRoleClient);
}

export const ROLE_LIBELLES: Record<Role, string> = {
  associe: "Associé",
  directeur_mission: "Directeur de mission",
  chef_mission: "Chef de mission",
  consultant: "Consultant",
  ressources: "Responsable des ressources",
  gestionnaire: "Gestionnaire administratif et financier",
  expert_metier: "Expert métier",
  expert_externe: "Expert externe",
  client_dirigeant: "Dirigeant client",
  client_contributeur: "Contributeur client",
  client_investisseur: "Investisseur",
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
  "questionnaire.lire", // lire les questionnaires et leurs réponses (V2, SOC-10)
  "questionnaire.gerer", // rédiger, valider et envoyer les questionnaires (V2, SOC-10/11)
  "notation.gerer", // piloter une notation : scoring, ajustements motivés (V2, NOT-03/04)
  "notation.publier", // publier un rapport de notation : expert_metier SEUL, pas même l'associé (V2, NOT-07)
  "ia.configurer", // clé OpenRouter, modèle par tâche, quotas (V2, ADR-003)
  "ia.utiliser", // lancer une génération IA (brouillon à valider par un humain) (V2)
  "portail.gerer", // inviter et gérer les utilisateurs du portail client (V2, SOC-09)
  "commentaire.ecrire", // commenter une entité VISIBLE (SOC-08) ; l'expert externe : ses seules missions
  "tache.assigner", // assigner une tâche de collaboration à un collègue (SOC-08)
  // --- V2 : plan stratégique, KPI, notation. Visibilité de la mission TOUJOURS exigée en plus ;
  // ni ressources ni gestionnaire (la masse salariale et les états du client sont confidentiels).
  "plan.lire", // lire un plan stratégique et son modèle financier (V2, PLA-01 à PLA-11)
  "plan.ecrire", // rédiger les éléments du plan et calculer le modèle financier (V2)
  "plan.valider", // valider un contenu du plan ou une version du modèle (V2, SOC-06)
  "kpi.lire", // lire les KPI, le tableau de bord et l'export (V2, KPI-01 à KPI-05)
  "kpi.gerer", // définir les KPI, cibles, contributeurs ; annuler une mesure du portail (V2)
  "kpi.saisir", // saisir, corriger, annuler une mesure côté cabinet (V2, KPI-02)
  "notation.lire", // lire une notation et son rapport (V2, NOT-01 à NOT-07)
  // --- V3, vague 1 (PRD complémentaire) : méthodes, dossier client, preuves, agents IA, qualité.
  // Visibilité de la mission TOUJOURS exigée en plus pour ce qui s'y rattache ; ni ressources, ni
  // gestionnaire, ni expert externe (données du client et jugement d'expert, comme le plan).
  "standard.lire", // lire méthodes, briques, facteurs et règles de modulation (STD-01 à STD-05)
  "standard.gerer", // variante cabinet : méthodes, pondérations, règles, activation (STD-03, STD-11)
  "methode.deroger", // demander une dérogation motivée sur une mission (STD-07)
  "dossier.lire", // lire le dossier client vivant et sa frise (DOS-01, DOS-02, DOS-06)
  "dossier.ecrire", // ajouter des faits datés et sourcés, ingérer des états financiers (DOS-02, DOS-03)
  "preuve.lire", // lire preuves, assertions, solidité et triangulation (PRV-01 à PRV-05)
  "preuve.ecrire", // enregistrer preuves et assertions, arbitrer une contradiction (PRV-01 à PRV-04)
  "agent.lire", // lire le registre des agents, leurs niveaux et la contribution IA (AGT-01, AGT-05)
  "agent.gerer", // configurer un agent : briques, plafond d'autonomie, jeux d'essai (AGT-01, AGT-04)
  "autonomie.decider", // promouvoir une brique de N2 à N3 : décision d'un associé SEUL (AGT-03)
  "qualite.relire", // relire un livrable : chef de mission, second expert R3 (QUA-03, QUA-04)
  "qualite.signer", // signer un livrable R3 : directeur de mission (QUA-04, QUA-06)
  // --- V3, vague 3 (PRD complémentaire §12) : capitalisation. Visibilité de la mission TOUJOURS
  // exigée en plus pour ce qui s'y rattache (retours d'expérience, recherche).
  "connaissance.lire", // recherche unifiée, retours d'expérience, base d'estimation (CAP-01, 02, 07)
  "competence.gerer", // référentiel de compétences, validation des niveaux déclarés (CAP-06)
  // Matrice de compétences de TOUS les collaborateurs (niveaux, déclarations en attente, preuves
  // d'usage) : donnée d'évaluation individuelle, donc alignée sur `competence.gerer` (associé,
  // directeur de mission, ressources) et NON sur `collaborateurs.lire`, que détiennent aussi
  // chef de mission et gestionnaire. Les autres rôles ne voient que leur propre vue
  // (`/capitalisation/competences/moi`, `temps.saisir`). Les temps (centièmes, jours) et les
  // preuves de la matrice exigent EN PLUS `budget.lire_jours`.
  "competence.lire",
  // --- V3, vague 3 (PRD complémentaire §9) : appels d'offres. L'offre financière exige EN PLUS
  // `finance.lire` (lecture) et `taux.gerer` (écriture), FIN-02.
  "ao.lire", // lire appels d'offres, banques de CV et de références, offres (AO-01 à AO-08)
  "ao.gerer", // tenir les banques de CV et de références, rédiger et valider les offres
  "ao.decider", // décider go ou no-go d'un appel d'offres : associé SEUL (AO-02)
  // --- V3, vague 2 (PRD complémentaire §13, CLI-01) : salle de mission. Visibilité de la
  // mission TOUJOURS exigée en plus.
  "salle.lire", // suivre les demandes documentaires, pièces et dépôts d'une mission (CLI-01)
  "salle.gerer", // préparer, envoyer, relancer une demande ; accepter ou rejeter une pièce (CLI-01)
  // --- V3, vague 2 (PRD complémentaire §8, ADR-006) : automatisation. Lever un coupe-circuit
  // revient à un associé (rôle, doublé en base : MPU02).
  "automatisation.lire", // catalogue, automatisations du cabinet, simulation, journal (AUT-01 à AUT-06)
  "automatisation.gerer", // créer, modifier, activer une automatisation ; couper ; annuler (AUT-02 à AUT-06)
  // --- Portail client (SOC-09) : réservées aux rôles client, jamais à un rôle interne.
  "portail.acceder", // son profil et son entreprise (/api/portail/moi)
  "portail.missions.lire", // missions, jalons et livrables PARTAGÉS de son entreprise
  "portail.factures.lire", // factures ÉMISES partagées de son entreprise
  "portail.jalons.valider", // valider un jalon partagé (dirigeant client)
  "portail.kpi.saisir", // saisir les mesures des KPI dont on est contributeur désigné (V2, KPI-02)
  "portail.questionnaires.repondre", // répondre aux questionnaires reçus (V2, SOC-10)
  "portail.salle.deposer", // déposer les pièces demandées par le cabinet (V3, CLI-01)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions propres aux utilisateurs du portail : aucun rôle interne ne les détient. */
export const PERMISSIONS_PORTAIL_CLIENT = [
  "portail.acceder",
  "portail.missions.lire",
  "portail.factures.lire",
  "portail.jalons.valider",
  "portail.kpi.saisir",
  "portail.questionnaires.repondre",
  "portail.salle.deposer",
] as const satisfies readonly Permission[];

/**
 * Permissions du CABINET que l'associé ne reçoit PAS avec « tout » : la publication d'une
 * notation est réservée au rôle expert_metier (NOT-07, DECISIONS.md ; route et déclencheur MPN04).
 */
const RESERVEES_A_UN_ROLE: readonly Permission[] = ["notation.publier"];

/** Permissions du CABINET de l'associé : toutes, sauf les réservées et celles du portail client. */
const TOUS: readonly Permission[] = PERMISSIONS.filter(
  (p) =>
    !(PERMISSIONS_PORTAIL_CLIENT as readonly string[]).includes(p) &&
    !RESERVEES_A_UN_ROLE.includes(p),
);

export const PERMISSIONS_PAR_ROLE: Record<Role, readonly Permission[]> = {
  associe: TOUS,
  directeur_mission: [
    "connaissance.lire",
    "competence.gerer",
    "competence.lire",
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
    "commentaire.ecrire",
    "tache.assigner",
    "questionnaire.lire",
    "questionnaire.gerer",
    "notation.gerer",
    "notation.lire",
    "ia.utiliser",
    "portail.gerer",
    "plan.lire",
    "plan.ecrire",
    "plan.valider",
    "kpi.lire",
    "kpi.gerer",
    "kpi.saisir",
    "standard.lire",
    "methode.deroger",
    "dossier.lire",
    "dossier.ecrire",
    "preuve.lire",
    "preuve.ecrire",
    "agent.lire",
    "qualite.relire",
    "qualite.signer",
    "salle.lire",
    "salle.gerer",
    "ao.lire",
    "ao.gerer",
    "automatisation.lire",
    "automatisation.gerer",
  ],
  chef_mission: [
    "connaissance.lire",
    "clients.lire",
    "collaborateurs.lire",
    "catalogue.lire",
    "pipeline.gerer",
    "mission.lire",
    "salle.lire",
    "salle.gerer",
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
    "commentaire.ecrire",
    "tache.assigner",
    "questionnaire.lire",
    "questionnaire.gerer",
    "notation.gerer",
    "notation.lire",
    "ia.utiliser",
    "portail.gerer",
    "plan.lire",
    "plan.ecrire",
    "plan.valider",
    "kpi.lire",
    "kpi.gerer",
    "kpi.saisir",
    "standard.lire",
    "methode.deroger",
    "dossier.lire",
    "dossier.ecrire",
    "preuve.lire",
    "preuve.ecrire",
    "agent.lire",
    "qualite.relire",
    "ao.lire",
    "ao.gerer",
    "automatisation.lire",
  ],
  consultant: [
    "connaissance.lire",
    "clients.lire",
    "catalogue.lire",
    "mission.lire",
    "salle.lire",
    "salle.gerer",
    "budget.lire_jours",
    "temps.saisir",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
    "commentaire.ecrire",
    "questionnaire.lire",
    "questionnaire.gerer",
    "notation.gerer",
    "notation.lire",
    "ia.utiliser",
    "plan.lire",
    "plan.ecrire",
    "kpi.lire",
    "kpi.saisir",
    "standard.lire",
    "dossier.lire",
    "dossier.ecrire",
    "preuve.lire",
    "preuve.ecrire",
    "agent.lire",
    "ao.lire",
    "ao.gerer",
  ],
  ressources: [
    "competence.gerer",
    "competence.lire",
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
    "commentaire.ecrire",
    "tache.assigner",
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
    "commentaire.ecrire",
    "tache.assigner",
    // Offre financière d'un appel d'offres (AO-07) : avec finance.lire et taux.gerer.
    "ao.lire",
  ],
  expert_metier: [
    "connaissance.lire",
    "catalogue.lire",
    "catalogue.ecrire",
    "mission.lire",
    "salle.lire",
    "temps.saisir",
    "document.ecrire",
    "conges.demander",
    "debours.saisir",
    "commentaire.ecrire",
    "questionnaire.lire",
    "notation.publier",
    "notation.lire",
    "ia.utiliser",
    "plan.lire",
    "kpi.lire",
    // Propriétaire de la variante cabinet des méthodes et des agents (STD-03) ; second expert
    // des livrables R3 (QUA-04) ; lit le dossier et les preuves, n'y écrit pas.
    "standard.lire",
    "standard.gerer",
    "dossier.lire",
    "preuve.lire",
    "agent.lire",
    "agent.gerer",
    "qualite.relire",
    "ao.lire",
  ],
  expert_externe: ["temps.saisir", "debours.saisir", "commentaire.ecrire"],
  // Portail client : lecture de SON entreprise, limitée aux partages explicites du cabinet ;
  // saisie des KPI et réponses aux questionnaires sur désignation explicite (jamais l'investisseur).
  client_dirigeant: [
    "portail.acceder",
    "portail.missions.lire",
    "portail.factures.lire",
    "portail.jalons.valider",
    "portail.kpi.saisir",
    "portail.questionnaires.repondre",
    "portail.salle.deposer",
  ],
  client_contributeur: [
    "portail.acceder",
    "portail.missions.lire",
    "portail.kpi.saisir",
    "portail.questionnaires.repondre",
    "portail.salle.deposer",
  ],
  // Investisseur (lecture d'une notation, V3) : profil seulement d'ici là.
  client_investisseur: ["portail.acceder"],
};

/** Les associés et gestionnaires seuls voient coûts, taux et marges (FIN-02). */
export function aPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => PERMISSIONS_PAR_ROLE[role].includes(permission));
}
