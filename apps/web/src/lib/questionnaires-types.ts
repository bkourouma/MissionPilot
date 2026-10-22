/** Sous-module de `questionnaires.ts` : types des réponses de l'API et délai de relance. */
import { type ModeEnvoiQuestionnaire, type RepondantEligible } from "@missionpilot/shared";
import type { OrigineIa } from "./questionnaires-ia";
import { type Definition } from "./questionnaires-definition";

// --- Réponses de l'API ------------------------------------------------------------------------

export type OrigineModele = "cabinet" | "gabarit" | "copie";
export type StatutVersion = "brouillon" | "valide";
export type StatutEnvoi = "brouillon" | "envoye" | "clos";
export type StatutReponse = "non_commence" | "brouillon" | "soumise";

/** Page d'une liste paginée par curseur (`paginer` de l'API). */
export interface PageQuestionnaires<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/** `GET /api/questionnaires/gabarits`. */
export interface GabaritResume {
  code: string;
  titre: string;
  sections: number;
  questions: number;
}

/** Élément de `GET /api/questionnaires/modeles`. */
export interface ModeleResume {
  id: string;
  code: string;
  titre: string;
  origine: OrigineModele;
  cree_le: string;
  modifie_le: string;
  /** Dernière version validée (envoyable), `null` s'il n'y en a pas. */
  version_validee_id: string | null;
  /** Un brouillon est en cours. */
  brouillon: boolean;
}

export interface VersionResume {
  id: string;
  modele_id: string;
  version: number;
  statut: StatutVersion;
  cree_le: string;
  modifie_le: string;
  valide_le: string | null;
  cree_par: string | null;
  valide_par: string | null;
}

/** `GET /api/questionnaires/modeles/:id` : versions de la plus récente à la plus ancienne. */
export interface ModeleDetail {
  id: string;
  code: string;
  titre: string;
  origine: OrigineModele;
  gabarit: string | null;
  copie_de: string | null;
  cree_par: string | null;
  cree_le: string;
  modifie_le: string;
  versions: VersionResume[];
}

/** `GET /api/questionnaires/versions/:id`. */
export interface VersionDetail extends VersionResume {
  code: string;
  definition: Definition;
  /** Origine IA (SOC-11) : statut du contenu et historique, `null` si rédigée à la main. */
  ia?: OrigineIa | null;
}

export interface ProgressionReponse {
  /** Part des questions obligatoires visibles répondues, entier de 0 à 100 (moteur). */
  pourcentage: number;
  complet: boolean;
  questions_visibles: number;
  questions_repondues: number;
  obligatoires_visibles: number;
  obligatoires_repondues: number;
}

export interface RepondantEnvoi {
  id: string;
  utilisateur_id: string;
  nom: string;
  email: string;
  fonction: string | null;
  relances: number;
  derniere_relance: string | null;
  /** Absents en mode collectif (la réponse est partagée : `reponse_collective`). */
  statut?: StatutReponse;
  soumise_le?: string | null;
  derniere_saisie?: string | null;
  progression?: ProgressionReponse;
}

export interface ReponseCollective {
  statut: StatutReponse;
  soumise_le: string | null;
  soumise_par_nom: string | null;
  derniere_saisie: string | null;
  progression: ProgressionReponse;
}

/** Élément de `GET /api/missions/:id/questionnaires`. */
export interface EnvoiResume {
  id: string;
  titre: string;
  mode: ModeEnvoiQuestionnaire;
  statut: StatutEnvoi;
  relances_auto: boolean;
  date_limite: string | null;
  cree_le: string;
  envoye_le: string | null;
  clos_le: string | null;
  version_id: string;
  repondants: number;
  reponses_soumises: number;
}

/** `GET /api/questionnaires/envois/:id`. */
export interface EnvoiDetail {
  id: string;
  mission_id: string;
  client_id: string;
  version_id: string;
  titre: string;
  mode: ModeEnvoiQuestionnaire;
  statut: StatutEnvoi;
  relances_auto: boolean;
  date_limite: string | null;
  cree_le: string;
  envoye_le: string | null;
  clos_le: string | null;
  definition: Definition;
  repondants: RepondantEnvoi[];
  reponse_collective: ReponseCollective | null;
  completude: { attendues: number; soumises: number; complet: boolean };
}

/** Réponse SOUMISE (`GET /api/questionnaires/envois/:id/reponses`) ; jamais un brouillon. */
export interface ReponseSoumise {
  id: string;
  repondant: { id: string; nom: string; fonction: string | null } | null;
  soumise_le: string;
  soumise_par_nom: string | null;
  reponses: Record<string, unknown>;
}

export interface ReponsesEnvoi {
  mode: ModeEnvoiQuestionnaire;
  elements: ReponseSoumise[];
}

/**
 * Répondant désignable (`GET /api/missions/:id/questionnaires/repondants-eligibles`,
 * `questionnaire.gerer`) : dirigeant ou contributeur actif du portail du client (non archivé)
 * de la mission, page par curseur triée par nom. Filtre et tri sont faits par l'API.
 */
export type { RepondantEligible };

/** Page de répondants désignables (`repondantsEligiblesReponseSchema`). */
export type PageRepondantsEligibles = PageQuestionnaires<RepondantEligible>;

/** Délai minimal entre deux relances d'un même répondant (règle de l'API, en heures). */
export const DELAI_RELANCE_HEURES = 24;
