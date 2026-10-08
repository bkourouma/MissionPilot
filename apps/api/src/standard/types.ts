import type {
  CasTypeCreation,
  ClasseRisque,
  NiveauAutonomie,
  RegleModulationApi,
  StatutVersionMethode,
  TypeElementMethode,
} from "@missionpilot/shared";

/** Origine d'une méthode : standard (ACC), variante d'un cabinet, ou méthode propre. */
export type OrigineMethode = "standard" | "variante" | "cabinet";

export interface MethodeLigne {
  id: string;
  cabinet_id: string | null;
  service_id: string;
  service_code: string;
  service_libelle: string;
  code: string;
  libelle: string;
  description: string | null;
  parent_id: string | null;
  cree_le: string;
}

export interface VersionLigne {
  id: string;
  cabinet_id: string | null;
  methode_id: string;
  version: number;
  statut: StatutVersionMethode;
  notes_version: string | null;
  base_standard_id: string | null;
  cree_par: string | null;
  cree_le: string;
  publie_le: string | null;
}

export interface EtapeContenu {
  code: string;
  libelle: string;
  description: string | null;
  ordre: number;
}

export interface BriqueContenu {
  etape_code: string;
  code: string;
  libelle: string;
  objet: string;
  entrees: string | null;
  moteur: string | null;
  agent: string | null;
  classe_risque: ClasseRisque;
  garde: string | null;
  sortie: string | null;
  definition_termine: string | null;
  temps_type_jours: number | null;
  profil_temps: string | null;
  niveau_autonomie_max: NiveauAutonomie;
  active_par_defaut: boolean;
  ordre: number;
}

export interface ElementContenu {
  brique_code: string | null;
  type: TypeElementMethode;
  code: string;
  libelle: string;
  description: string | null;
  essentiel: boolean;
  actif_par_defaut: boolean;
}

export interface AncrageRubrique {
  niveau: number;
  description: string;
  exemples: { contexte: string; texte: string }[];
}

export interface RubriqueContenu {
  brique_code: string | null;
  code: string;
  libelle: string;
  dimension: string | null;
  ancrages: AncrageRubrique[];
}

export interface RegleContenu {
  code: string;
  regle: RegleModulationApi;
}

/** Cas type stocké : forme de l'API (`casTypeCreationSchema`, sans le code). */
export type CasStocke = Omit<CasTypeCreation, "code" | "libelle">;

export interface CasTypeContenu {
  code: string;
  libelle: string | null;
  cas: CasStocke;
}

/** Contenu d'une version, sans identifiants : sert à la copie, à la fusion et aux différences. */
export interface ContenuMethode {
  etapes: EtapeContenu[];
  briques: BriqueContenu[];
  elements: ElementContenu[];
  rubriques: RubriqueContenu[];
  regles: RegleContenu[];
  cas_types: CasTypeContenu[];
}

/** Contenu lu en base : chaque ligne porte aussi son identifiant. */
export interface ContenuVersion {
  methode: MethodeLigne;
  version: VersionLigne;
  etapes: (EtapeContenu & { id: string })[];
  briques: (BriqueContenu & { id: string; etape_id: string })[];
  elements: (ElementContenu & { id: string; brique_id: string | null })[];
  rubriques: (RubriqueContenu & { id: string; brique_id: string | null })[];
  regles: (RegleContenu & { id: string })[];
  cas_types: (CasTypeContenu & { id: string })[];
}

export function origineMethode(m: Pick<MethodeLigne, "cabinet_id" | "parent_id">): OrigineMethode {
  if (m.cabinet_id === null) return "standard";
  return m.parent_id ? "variante" : "cabinet";
}
