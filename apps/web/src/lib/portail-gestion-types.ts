/** Gestion du portail : réponses de l'API (module extrait de `portail-gestion.ts`). */
import {
  type Role,
  type StatutContenu,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";
import type { Mission } from "./missions";

export type StatutUtilisateurPortail = "actif" | "desactive";

/** Élément de `GET /api/portail/utilisateurs?client_id=` (jamais de hachage ni de jeton). */
export interface UtilisateurPortail {
  id: string;
  nom: string;
  email: string;
  roles: Role[];
  statut: StatutUtilisateurPortail;
  cree_le: string;
  tfa_active: boolean;
}

/** Invitation du portail en attente (le jeton n'est jamais renvoyé : il part par e-mail). */
export interface InvitationPortail {
  id: string;
  email: string;
  roles: Role[];
  expire_le: string;
  cree_le: string;
}

export interface UtilisateursPortailClient {
  utilisateurs: UtilisateurPortail[];
  invitations: InvitationPortail[];
}

/** Mission partagée, telle que lue par le cabinet (`gerable` : modifiable par l'utilisateur). */
export interface PartageMissionLu {
  mission_id: string;
  intitule: string;
  statut: StatutMission;
  jalons: boolean;
  factures: boolean;
  partage_le: string;
  gerable: boolean;
}

/** Document partagé : une VERSION précise d'un livrable ou d'une lettre de mission. */
export interface DocumentPartageLu {
  document_id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  partage_le: string;
}

/** Réponse de `GET` et `PUT /api/portail/partages?client_id=`. */
export interface PartagesClient {
  client: { id: string; raison_sociale: string; actif: boolean };
  contact_principal: { id: string; nom: string } | null;
  missions: PartageMissionLu[];
  documents: DocumentPartageLu[];
}

/** Réponse de `GET` et `PUT /api/portail/parametres`. */
export interface ParametresPortail {
  tfa_obligatoire: boolean;
}

/** Mission du client (liste `GET /api/missions?client_id=`), réduite à ce qui sert ici. */
export type MissionClient = Pick<
  Mission,
  "id" | "intitule" | "statut" | "directeur_id" | "chef_id" | "date_debut" | "date_fin"
>;

/** Dernière version d'un document de mission (`GET /api/missions/:id/documents`). */
export interface DocumentCandidat {
  id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  statut_contenu: StatutContenu | null;
}
