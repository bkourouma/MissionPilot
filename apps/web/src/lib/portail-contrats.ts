/** Espace client : contrats de l'API `/api/portail/*` (types partagés par les modules du portail). */
import type { StatutFacture, StatutMission, StatutPaiement } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

// --- Contrats de l'API ---------------------------------------------------------------------

/** `GET /api/portail/moi`. */
export interface ProfilPortail {
  utilisateur: { id: string; nom: string; email: string; roles: string[] };
  entreprise: { id: string; raison_sociale: string };
  cabinet: { nom: string };
  contact_principal: { nom: string; email: string | null } | null;
  /**
   * Limité aux droits du rôle : `missions` et `documents` absents sans
   * « portail.missions.lire », `factures` absent sans « portail.factures.lire »
   * (l'investisseur reçoit `{}`). Une clé absente vaut « rien de partagé ».
   */
  partages: { missions?: number; documents?: number; factures?: boolean };
}

/** Page d'une liste du portail (curseur opaque). */
export interface PagePortail<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface MissionPortail {
  id: string;
  intitule: string;
  statut: StatutMission;
  date_debut: string | null;
  date_fin: string | null;
  partage: { jalons: boolean; factures: boolean };
}

export interface ValidationJalon {
  valide_le: string;
  commentaire: string | null;
  valide_par_moi: boolean;
}

export interface JalonPortail {
  id: string;
  libelle: string;
  date_prevue: string | null;
  atteint: boolean;
  validation: ValidationJalon | null;
}

export interface LivrablePortail {
  id: string;
  type: string;
  nom: string;
  version: number;
  depose_le: string;
  type_mime: string | null;
  taille: number | null;
  telechargeable: boolean;
}

export interface PaiementPortail {
  statut_paiement: StatutPaiement;
  encaisse: number;
  solde: number;
  jours_retard: number;
}

export interface FacturePortail {
  id: string;
  nature: "facture" | "avoir";
  numero: string | null;
  facture_origine_id: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  devise: string;
  statut: StatutFacture;
  objet: string | null;
  mission: { id: string; intitule: string };
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  total_retenues: number;
  net_a_payer: number;
  paiement: PaiementPortail | null;
}

/** Libellé affiché et sa tonalité. */
export type Libelle = { libelle: string; tonalite: TonaliteStatut };
