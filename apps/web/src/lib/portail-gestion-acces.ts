/** Gestion du portail : chemins, droits, rôles et invitation (module extrait de `portail-gestion.ts`). */
import type { MissionClient, StatutUtilisateurPortail } from "./portail-gestion-types";
import {
  aPermission,
  estRoleClient,
  ROLE_LIBELLES,
  ROLES_CLIENT,
  type Role,
  type RoleClient,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { FORMAT_EMAIL, type Resultat } from "./saisie";
import { ongletsClient } from "./taux-clients";

// --- Chemins ---------------------------------------------------------------------------------

const requeteClient = (clientId: string) => `client_id=${encodeURIComponent(clientId)}`;

export const cheminUtilisateursPortail = (clientId: string) =>
  `/api/portail/utilisateurs?${requeteClient(clientId)}`;
export const cheminPartagesPortail = (clientId: string) =>
  `/api/portail/partages?${requeteClient(clientId)}`;
export const CHEMIN_INVITATIONS_PORTAIL = "/api/portail/invitations";
export const cheminInvitationPortail = (id: string) =>
  `${CHEMIN_INVITATIONS_PORTAIL}/${encodeURIComponent(id)}`;
export const cheminStatutUtilisateurPortail = (id: string, action: "desactiver" | "reactiver") =>
  `/api/portail/utilisateurs/${encodeURIComponent(id)}/${action}`;
export const CHEMIN_PARAMETRES_PORTAIL = "/api/portail/parametres";
export const cheminDocumentsMission = (missionId: string) =>
  `/api/missions/${encodeURIComponent(missionId)}/documents`;

/** Page de gestion du portail d'un client, et page de la politique du portail. */
export const hrefPortailClient = (clientId: string) => `/clients/${clientId}/portail`;
export const HREF_POLITIQUE_PORTAIL = "/parametres/portail";

// --- Droits (confort d'affichage : l'API décide) -------------------------------------------

export const gerePortail = (roles: readonly Role[]) => aPermission(roles, "portail.gerer");
export const modifiePolitiquePortail = (roles: readonly Role[]) =>
  aPermission(roles, "cabinet.gerer");
const gereToutesLesMissions = (roles: readonly Role[]) =>
  aPermission(roles, "mission.modifier_toutes");

/** Onglets de la fiche client, complétés de « Portail client » pour qui gère le portail. */
export function ongletsClientAvecPortail(id: string, roles: readonly Role[]) {
  return [
    ...ongletsClient(id, roles),
    ...(gerePortail(roles)
      ? [{ id: "portail", libelle: "Portail client", href: hrefPortailClient(id) }]
      : []),
  ];
}

/** Partages d'une mission modifiables : toutes avec « mission.modifier_toutes », sinon les siennes. */
export function missionGerable(
  m: Pick<MissionClient, "directeur_id" | "chef_id">,
  utilisateurId: string,
  roles: readonly Role[],
): boolean {
  return (
    gereToutesLesMissions(roles) || m.directeur_id === utilisateurId || m.chef_id === utilisateurId
  );
}

/**
 * L'utilisateur gère-t-il le portail de ce client ? Comme `exigerClientGere` de l'API : toutes
 * les missions modifiables, ou la direction (directeur ou chef) d'au moins une de ses missions.
 */
export function gereLeClient(
  missions: readonly Pick<MissionClient, "directeur_id" | "chef_id">[],
  utilisateurId: string,
  roles: readonly Role[],
): boolean {
  if (!gerePortail(roles)) return false;
  return (
    gereToutesLesMissions(roles) || missions.some((m) => missionGerable(m, utilisateurId, roles))
  );
}

// --- Rôles du portail ------------------------------------------------------------------------

/** Ce que chaque rôle du portail permet à la personne invitée. */
export const ROLE_PORTAIL_DESCRIPTIONS: Record<RoleClient, string> = {
  client_dirigeant:
    "Voit les missions partagées, valide leurs jalons et consulte les factures émises partagées.",
  client_contributeur:
    "Voit les missions, jalons et livrables partagés et répond aux questionnaires ; il ne voit pas les factures.",
  client_investisseur:
    "Consulte les notes de due diligence que le cabinet lui communique, en lecture seule ; il ne voit ni missions, ni jalons, ni livrables, ni factures.",
};

export const OPTIONS_ROLES_PORTAIL = ROLES_CLIENT.map((r) => ({
  valeur: r,
  libelle: ROLE_LIBELLES[r],
  aide: ROLE_PORTAIL_DESCRIPTIONS[r],
}));

/** Libellés des rôles du portail d'un compte (un rôle interne n'est jamais affiché ici). */
export function libellesRolesPortail(roles: readonly string[]): string {
  const libelles = roles.filter(estRoleClient).map((r) => ROLE_LIBELLES[r]);
  return libelles.length === 0 ? "Aucun rôle du portail" : libelles.join(", ");
}

export const STATUT_UTILISATEUR_PORTAIL: Record<
  StatutUtilisateurPortail,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  actif: { libelle: "Accès actif", tonalite: "succes" },
  desactive: { libelle: "Accès désactivé", tonalite: "neutre" },
};

export function statutUtilisateurPortail(statut: string): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  return (
    STATUT_UTILISATEUR_PORTAIL[statut as StatutUtilisateurPortail] ?? {
      libelle: "Statut inconnu",
      tonalite: "neutre",
    }
  );
}

// --- Invitation ------------------------------------------------------------------------------

export type ChampInvitationPortail = "email" | "role";

export interface SaisieInvitationPortail {
  email: string;
  role: string;
}

export interface ChargeInvitationPortail {
  email: string;
  client_id: string;
  roles: RoleClient[];
}

/** Corps de `POST /api/portail/invitations` : e-mail normalisé, UN rôle du portail. */
export function validerInvitationPortail(
  s: SaisieInvitationPortail,
  clientId: string,
): Resultat<ChargeInvitationPortail, ChampInvitationPortail> {
  const erreurs: Partial<Record<ChampInvitationPortail, string>> = {};
  const email = s.email.trim().toLowerCase();
  if (email === "") erreurs.email = "Saisissez l'adresse e-mail de la personne à inviter.";
  else if (!FORMAT_EMAIL.test(email) || email.length > 254)
    erreurs.email = "Adresse e-mail invalide. Exemple : prenom.nom@entreprise.ci";
  if (!estRoleClient(s.role)) erreurs.role = "Choisissez le rôle de la personne sur le portail.";
  if (Object.keys(erreurs).length > 0 || !estRoleClient(s.role)) return { ok: false, erreurs };
  return { ok: true, charge: { email, client_id: clientId, roles: [s.role] } };
}
