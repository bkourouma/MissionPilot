import type { ClasseRisque, NiveauAutonomie } from "@missionpilot/shared";

/** Types des réponses de l'API « Agents IA ». */

export interface AgentIa {
  code: string;
  version: number;
  nom: string;
  mission: string;
  ne_fait_jamais: string;
  entrees: string[];
  outils_autorises: string[];
  droits: string[];
  briques: string[];
  taches: string[];
  niveau_max_standard: NiveauAutonomie;
  niveau_max_cabinet: NiveauAutonomie | null;
  niveau_max: NiveauAutonomie;
  lit_contenu_client: boolean;
  notes_version: string;
  actif: boolean;
  restriction: { motif: string; auteur_id: string; cree_le: string } | null;
}

export interface CoupeCircuitIa {
  actif: boolean;
  motif: string | null;
  auteur_id: string | null;
  modifie_le: string | null;
}

export interface EtatAutonomieIa {
  niveau_accorde: NiveauAutonomie;
  plafond: NiveauAutonomie;
  niveau_effectif: NiveauAutonomie;
  raisons: string[];
  coupe_circuit_n4: boolean;
}

export interface BriqueIa {
  id: string;
  code: string;
  agent: { code: string; nom: string; niveau_max: NiveauAutonomie } | null;
  classe_risque: ClasseRisque;
  niveau_max: NiveauAutonomie;
  niveau_accorde: NiveauAutonomie;
  depuis: string;
  cree_le: string;
  autonomie: EtatAutonomieIa | null;
}

export interface PageBriquesIa {
  coupe_circuit: CoupeCircuitIa;
  elements: BriqueIa[];
  curseur_suivant: string | null;
}

export interface EligibiliteIa {
  statistiques: {
    executions: number;
    accepteesSansModificationMajeure: number;
    incidentsMajeursFenetre: number;
  };
  evaluation: {
    eligible: boolean;
    niveauPropose: NiveauAutonomie | null;
    raisons: string[];
    tauxAcceptation: number | null;
  };
  niveau_suivant: NiveauAutonomie | null;
  criteres_requis: boolean;
}

export interface EvenementAutonomieIa {
  id: string;
  type: "initial" | "promotion" | "abaissement" | "retrogradation_auto";
  niveau_avant: NiveauAutonomie | null;
  niveau_apres: NiveauAutonomie;
  motif: string;
  auteur_nom: string | null;
  cree_le: string;
}

export interface IncidentIa {
  id: string;
  gravite: "mineur" | "majeur";
  description: string;
  signale_par_nom: string;
  cree_le: string;
}

export interface DetailBriqueIa extends BriqueIa {
  eligibilite: EligibiliteIa;
  historique: { evenements: EvenementAutonomieIa[]; incidents: IncidentIa[]; tronque: boolean };
}

export interface ExecutionIa {
  id: string;
  agent: { code: string; version: number; nom: string };
  brique: { id: string; code: string } | null;
  classe_risque: ClasseRisque | null;
  mission_id: string | null;
  demande_id: string;
  declencheur: { id: string; nom: string };
  niveau_effectif: NiveauAutonomie;
  prompt: { nom: string; version: number };
  tache: string;
  fournisseur: "openrouter" | "gabarit";
  modele: string | null;
  mode_degrade: boolean;
  cout_micro_usd?: number;
  sources: { type: string; id: string; libelle: string }[];
  entree: { empreinte: string };
  sortie_valide: boolean;
  chiffres_non_verifies: boolean;
  donnees_non_fiables: string[];
  signaux_injection: string[];
  decision: {
    decision: "acceptee" | "modifiee" | "rejetee";
    taux_modification_pct: number | null;
    motif: string | null;
    decideur: { id: string; nom: string };
    cree_le: string;
  } | null;
  cree_le: string;
}

export interface PageIaAgents<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface ContributionIaLigne {
  id: string;
  livrable_type: string;
  livrable_id: string;
  mission_id: string | null;
  agent_code: string | null;
  brique_code: string | null;
  mots_brouillon: number;
  mots_valides: number;
  part_conservee_pct: number | null;
  taux_modification_pct: number;
  modification_majeure: boolean;
  temps_revue_secondes: number;
  exacte: boolean;
  cree_le: string;
}

export interface ContributionsIa extends PageIaAgents<ContributionIaLigne> {
  synthese: {
    livrables: number;
    motsBrouillon: number;
    motsConserves: number;
    partConservee: number | null;
    modificationsMajeures: number;
    totalRevueSecondes: number;
    exacte: boolean;
  };
}

export interface JeuEssaiIa {
  id: string;
  prompt_nom: string;
  version: number;
  brique_code: string | null;
  description: string;
  cas: { code: string }[];
  auteur_nom: string;
  cree_le: string;
}

export interface EvaluationIa {
  id: string;
  prompt_nom: string;
  jeu_version: number;
  prompt_id: string;
  prompt_version: number;
  prompt_reference_version: number | null;
  modele: string;
  fournisseur: "local" | "openrouter";
  cas_total: number;
  cas_reussis: number;
  regressions: number;
  reussie: boolean;
  resultats: {
    code: string;
    reussi: boolean;
    raisons: string[];
    reference_reussi: boolean | null;
  }[];
  lance_par_nom: string;
  cree_le: string;
}
