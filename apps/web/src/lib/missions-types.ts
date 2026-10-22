/** Missions : types du contrat de l'API, libellés des statuts et des types de document. */
import {
  STATUTS_MISSION,
  TYPES_DOCUMENT,
  type ModeFacturation,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { Devise } from "./format";

export interface Mission {
  id: string;
  intitule: string;
  client_id: string;
  client_raison_sociale: string;
  type_mission_id: string | null;
  opportunite_id: string | null;
  proposition_id: string | null;
  mission_source_id: string | null;
  directeur_id: string | null;
  chef_id: string | null;
  date_debut: string | null;
  date_fin: string | null;
  devise: Devise;
  mode_facturation: ModeFacturation;
  statut: StatutMission;
  activite: string | null;
  secteur: string | null;
  bureau: string | null;
  date_signature: string | null;
  taux_change: number | null;
  devise_reference: string | null;
  cloturee_le: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface MissionDetaillee extends Mission {
  equipe: { utilisateur_id: string; nom: string }[];
}

export interface DocumentMission {
  id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  auteur_nom: string | null;
  chemin_stockage: string | null;
  cree_le: string;
}

export const STATUT_MISSION: Record<StatutMission, { libelle: string; tonalite: TonaliteStatut }> =
  {
    opportunite: { libelle: "Opportunité", tonalite: "neutre" },
    proposition: { libelle: "Proposition", tonalite: "neutre" },
    signee: { libelle: "Signée", tonalite: "succes" },
    en_cours: { libelle: "En cours", tonalite: "succes" },
    a_cloturer: { libelle: "À clôturer", tonalite: "attention" },
    cloturee: { libelle: "Clôturée", tonalite: "neutre" },
  };

export const OPTIONS_STATUTS_MISSION = STATUTS_MISSION.map((s) => ({
  valeur: s,
  libelle: STATUT_MISSION[s].libelle,
}));

export const TYPE_DOCUMENT_LIBELLES: Record<TypeDocument, string> = {
  proposition: "Proposition",
  lettre_de_mission: "Lettre de mission",
  livrable: "Livrable",
  autre: "Autre document",
};

export const OPTIONS_TYPES_DOCUMENT = TYPES_DOCUMENT.map((t) => ({
  valeur: t,
  libelle: TYPE_DOCUMENT_LIBELLES[t],
}));

/** Statuts où la lettre de mission est signée : budget initial figé, devise figée. */
export const STATUTS_SIGNES: readonly StatutMission[] = [
  "signee",
  "en_cours",
  "a_cloturer",
  "cloturee",
];
export const estSignee = (statut: StatutMission) => STATUTS_SIGNES.includes(statut);
