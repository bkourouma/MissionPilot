/** Services candidats : formes de réponse de l'API (module extrait de `services-candidats.ts`). */
import {
  type CodeServiceCandidat,
  type ObjetFinancement,
  type TypeGuichet,
} from "@missionpilot/shared";
import { type Devise } from "./format";

export interface MethodePubliee {
  methode_id: string;
  version_id: string;
  version: number;
  libelle: string;
}

export interface ServiceCandidat {
  code: CodeServiceCandidat;
  libelle: string;
  description: string | null;
  methode: MethodePubliee | null;
  coherence: { valide: boolean; erreurs: string[]; avertissements: string[] } | null;
  type_mission: { id: string; a_valider: boolean } | null;
  prix: {
    montant: number | null;
    devise: string;
    /** Prix à saisir par le cabinet avant d'activer le type de mission (aucun prix par défaut). */
    a_fixer: boolean;
    personnalise: boolean;
    commentaire: string | null;
  };
  a_valider_expert: true;
}

export interface Guichet {
  id: string;
  nom: string;
  type: TypeGuichet;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  date_limite: string | null;
  description: string | null;
  url: string | null;
  actif: boolean;
  a_valider: boolean;
}

export type StatutRapprochement = "compatible" | "partiel" | "exclu";
export type VerdictCritere = "ok" | "ko" | "inconnu" | "non_restreint";

export interface CritereRapprochement {
  critere: string;
  verdict: VerdictCritere;
  detail: string;
}

export interface ResultatRapprochement {
  guichet: Pick<Guichet, "id" | "nom" | "type" | "description" | "url" | "date_limite">;
  statut: StatutRapprochement;
  score: number;
  criteres: CritereRapprochement[];
  raisons_exclusion: string[];
}

export interface ReponseRapprochement {
  profil_utilise: Record<string, unknown>;
  dossier: { client_id: string; chiffre_affaires_millions: number | null } | null;
  resultats: ResultatRapprochement[];
  /** Vrai si l'API n'a rapproché qu'une partie des guichets. */
  tronque?: boolean;
  avertissement: string;
}
