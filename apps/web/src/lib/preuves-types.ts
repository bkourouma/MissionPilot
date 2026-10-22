import type {
  DecisionArbitrage,
  LectureSoliditeApi,
  RattachementAssertion,
  StatutAssertion,
  TypeSourcePreuve,
} from "@missionpilot/shared";

/** Réponses de l'API du registre des preuves. */

export type ClasseRisqueApi = "R0" | "R1" | "R2" | "R3";
export type FiabiliteApi = "A" | "B" | "C" | "D";
export type SensApi = "pour" | "contre";

export interface PreuveVue {
  id: string;
  mission_id: string;
  version: number;
  type_source: TypeSourcePreuve;
  source_precise: string;
  date_preuve: string;
  auteur: { id: string; nom: string | null };
  fiabilite: FiabiliteApi;
  extrait: string | null;
  fichier_id: string | null;
  reponse_id: string | null;
  document_id: string | null;
  dimensions: string[];
  nominatif: boolean;
  accord_nominatif: boolean;
  /** Verbatim nominatif sans accord, masqué pour ce lecteur. */
  masque: boolean;
  motif: string | null;
  cree_le: string;
  version_cree_le: string;
}

export interface AssertionLieeAPreuve {
  assertion_id: string;
  sens: SensApi;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
}

export interface DetailPreuve extends PreuveVue {
  versions: PreuveVue[];
  assertions: AssertionLieeAPreuve[];
}

export interface ArbitrageVue {
  id: string;
  preuve_id: string;
  preuve_version: number;
  decision: DecisionArbitrage;
  motif: string;
  arbitre: { id: string; nom: string | null };
  arbitre_le: string;
}

export interface SoliditeVue {
  indice: number;
  numerateur: number;
  denominateur: number;
  lecture: LectureSoliditeApi;
  fiabilites_retenues: {
    type_source: TypeSourcePreuve;
    fiabilite: FiabiliteApi;
    poids_centiemes: number;
  }[];
  somme_centiemes: number;
  plafonnee: boolean;
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
  plafond_centiemes: number;
  seuil_solide: number;
  seuil_etayee: number;
}

export interface AvisExpertVue {
  motif: string | null;
  signe: boolean;
  signe_par: { id: string; nom: string | null } | null;
  signe_le: string | null;
}

export interface AssertionVue {
  id: string;
  mission_id: string;
  version: number;
  enonce: string;
  rattachement: { type: RattachementAssertion; code: string } | null;
  livrable: string | null;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
  avis_expert: AvisExpertVue | null;
  motif: string | null;
  auteur: { id: string; nom: string | null };
  cree_le: string;
  version_cree_le: string;
}

export interface ElementAssertion extends AssertionVue {
  solidite?: SoliditeVue;
  a_arbitrer: number;
}

export interface PreuveLiee extends PreuveVue {
  sens: SensApi;
  a_arbitrer: boolean;
  arbitrage: ArbitrageVue | null;
}

export interface VersionAssertion {
  version: number;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
  avis_expert: boolean;
  signe_par: { id: string; nom: string | null } | null;
  signe_le: string | null;
  motif: string | null;
  auteur: { id: string; nom: string | null };
  cree_le: string;
}

export interface DetailAssertion extends AssertionVue {
  solidite: SoliditeVue;
  preuves_pour: PreuveLiee[];
  preuves_contre: PreuveLiee[];
  historique: VersionAssertion[];
  arbitrages: ArbitrageVue[];
}

export interface PageApi<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface DimensionVue {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
  cree_le: string;
}

export interface CarteTriangulationVue {
  dimensions: {
    code: string;
    libelle: string;
    types_couverts: TypeSourcePreuve[];
    types_manquants: TypeSourcePreuve[];
    preuves: number;
    couverte: boolean;
    triangulee: boolean;
  }[];
  cellules: {
    dimension: string;
    type_source: TypeSourcePreuve;
    preuves: number;
    meilleure_fiabilite: FiabiliteApi | null;
  }[];
  zones_non_couvertes: { dimension: string; type_source: TypeSourcePreuve }[];
  dimensions_non_couvertes: string[];
  dimensions_sous_triangulees: string[];
  rattachements_inconnus: { preuve: string; dimension: string }[];
  preuves_ecartees: string[];
}

export interface ContradictionVue {
  assertion: AssertionVue;
  solidite: SoliditeVue;
  preuves_pour: PreuveLiee[];
  preuves_contre: PreuveLiee[];
  a_arbitrer: string[];
}

export interface ControleLivrableVue {
  conforme: boolean;
  controlees: number;
  ignorees: number;
  anomalies: {
    assertion_id: string;
    classe_risque: ClasseRisqueApi;
    code: "SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE";
    enonce: string;
    livrable: string | null;
  }[];
  livrable: string | null;
}

export interface AssertionFragileVue {
  id: string;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  livrable: string | null;
  statut: StatutAssertion;
  avis_expert: boolean;
  avis_expert_signe: boolean;
  indice: number;
  lecture: LectureSoliditeApi;
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
}
