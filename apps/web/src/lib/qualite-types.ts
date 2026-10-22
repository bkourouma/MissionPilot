/** Qualité : types des réponses de l'API (module extrait de `qualite.ts`). */
import {
  type ClasseRisque,
  type DecisionAcceptation,
  type EtapeGardeQualite,
  type KindElementRevue,
  type NiveauRisqueClient,
  type StatutSuivi,
  type StatutVerification,
  type TypeLivrable,
} from "@missionpilot/shared";

export interface SuiviResume {
  id: string;
  mission_id: string;
  mission_intitule: string;
  type_livrable: TypeLivrable;
  libelle: string;
  version: number;
  classe: ClasseRisque;
  statut: StatutSuivi;
  elements_obligatoires: number;
  elements_vus_par_moi: number;
  validations_faites: number;
  ouvert_le: string;
}

export interface PageSuivis {
  elements: SuiviResume[];
  curseur_suivant: string | null;
}

export interface Suivi {
  id: string;
  mission_id: string;
  type_livrable: TypeLivrable;
  livrable_id: string;
  libelle: string;
  version: number;
  classe_minimale: ClasseRisque;
  classe: ClasseRisque;
  statut: StatutSuivi;
  auteur_id: string | null;
  ouvert_le: string;
}

export type CodeViolation =
  "AUTEUR_ATTENDU" | "CUMUL_INTERDIT" | "QUATRE_YEUX" | "ETAPE_EN_DOUBLE" | "ACTEUR_NON_HABILITE";

export interface Violation {
  code: CodeViolation;
  roles: string[];
  acteur: string;
}

export interface GardeSuivi {
  classe: ClasseRisque;
  automatique: boolean;
  etapes_requises: EtapeGardeQualite[];
  etapes_faites: EtapeGardeQualite[];
  manquantes: EtapeGardeQualite[];
  prochaine_etape: EtapeGardeQualite | null;
  violations: Violation[];
  /** Étapes franchies avant le dépôt d'éléments que leur auteur n'a pas encore parcourus. */
  etapes_a_reconfirmer: EtapeGardeQualite[];
  peut_valider_prochaine_etape: boolean;
}

export interface ValidationSuivi {
  etape: EtapeGardeQualite;
  acteur_id: string;
  acteur_nom: string | null;
  commentaire: string | null;
  valide_le: string;
  /** Suspendue : des éléments obligatoires ont été déposés depuis et l'auteur ne les a pas parcourus. */
  a_reconfirmer: boolean;
}

export interface ItemDefinition {
  id: string;
  code: string;
  libelle: string;
  controle: string;
  obligatoire: boolean;
  statut: StatutVerification | "en_attente";
  detail: string | null;
  satisfait: boolean;
}

export interface DefinitionSuivi {
  definition_id: string | null;
  libelle: string | null;
  version: number | null;
  items: ItemDefinition[];
  satisfaite: boolean;
  bloquants: string[];
}

export interface ElementRevue {
  id: string;
  cle: string;
  kind: KindElementRevue;
  libelle: string;
  obligatoire: boolean;
  source: string | null;
  reference: string | null;
  vu_par_moi: boolean;
  vu_le: string | null;
  nb_vus: number;
}

export interface Parcours {
  obligatoires: number;
  vus: number;
  restants: number;
  complet: boolean;
}

export interface SessionRevue {
  id: string;
  utilisateur_id: string;
  debut: string;
  fin: string | null;
  duree_secondes: number | null;
}

export interface TempsRevue {
  sessions: SessionRevue[];
  synthese: {
    sessions: number;
    totalSecondes: number;
    medianeSecondes: number;
    maxSecondes: number;
  };
}

export interface SignatureSuivi {
  signataire_nom: string | null;
  qualite: string;
  version: number;
  empreinte_sha256: string;
  portee_empreinte: "contenu" | "dossier_qualite";
  mention_ia: string | null;
  signe_le: string;
}

export interface EvenementSuivi {
  rang: number;
  action: string;
  par_nom: string | null;
  le: string;
}

export interface DetailSuivi {
  suivi: Suivi;
  mission: { id: string; intitule: string };
  garde: GardeSuivi;
  validations: ValidationSuivi[];
  definition: DefinitionSuivi;
  elements: ElementRevue[];
  parcours: Parcours;
  temps_revue: TempsRevue;
  signature: SignatureSuivi | null;
  evenements: EvenementSuivi[];
}

export interface Conflit {
  relation_id: string;
  nature: string;
  client_lie_id: string;
  client_lie_nom: string;
  missions_en_cours: number;
  /** Absente sans le droit de signer (note interne de la relation). */
  note?: string | null;
}

export interface Acceptation {
  id: string;
  rang: number;
  conflits: Conflit[];
  profil_risque: {
    facteurs: string[];
    niveau_calcule: NiveauRisqueClient;
    niveau_retenu: NiveauRisqueClient;
  };
  niveau_risque: NiveauRisqueClient;
  decision: DecisionAcceptation;
  motif: string | null;
  evalue_par_nom: string | null;
  evalue_le: string;
}

export interface VueAcceptation {
  derniere: Acceptation | null;
  historique: Acceptation[];
  conflits_actuels: Conflit[];
}

export interface SyntheseNps {
  total: number;
  promoteurs: number;
  passifs: number;
  detracteurs: number;
  nps: string | null;
}

export interface NoteSatisfaction {
  id: string;
  moment: "jalon" | "cloture";
  jalon_libelle: string | null;
  rang: number;
  note: number;
  commentaire: string | null;
  repondant: string | null;
  saisi_le: string;
}

export interface VueSatisfactions {
  notes: NoteSatisfaction[];
  synthese: SyntheseNps;
}

export interface SyntheseCabinet {
  synthese: SyntheseNps;
  missions: (SyntheseNps & { mission_id: string; mission_intitule: string })[];
  tronque: boolean;
}
