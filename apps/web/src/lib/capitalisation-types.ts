import type { OrigineRetour, RetourVersion, TypeResultatRecherche } from "@missionpilot/shared";

/** Types des réponses de l'API « Connaissances » (capitalisation). */

export interface ResultatRecherche {
  type: TypeResultatRecherche;
  id: string;
  titre: string;
  extrait: string | null;
  mission_id: string;
  mission_intitule: string;
  date: string;
}

export interface ReponseRecherche {
  q: string;
  par_type: Partial<Record<TypeResultatRecherche, { nombre: number; tronque: boolean }>>;
  elements: ResultatRecherche[];
}

export interface RetourResume {
  id: string;
  mission_id: string;
  mission_intitule: string;
  client: string;
  statut: "brouillon" | "valide";
  version_validee: number | null;
  valide_le: string | null;
  ouvert_le: string;
}

/** Mission clôturée sans retour d'expérience (rattrapage : `GET /capitalisation/retours/a-ouvrir`). */
export interface MissionSansRetour {
  id: string;
  mission_id: string;
  mission_intitule: string;
  client: string;
  cloturee_le: string;
  /** Responsable de la mission (chef, directeur ou associé) : confort d'affichage. */
  peut_ouvrir: boolean;
}

export type StatutContenu = "brouillon_ia" | "modifie" | "valide";

export interface VersionRetour extends RetourVersion {
  version: number;
  origine: OrigineRetour;
  statut_contenu: StatutContenu;
  chiffres_non_verifies: boolean;
  cree_par_nom: string | null;
  cree_le: string;
}

export interface RetourDetail {
  id: string;
  mission_id: string;
  statut: "brouillon" | "valide";
  version_validee: number | null;
  valide_le: string | null;
  ouvert_le: string;
  mission: { id: string; intitule: string; statut: string; client: string };
  version_courante: VersionRetour | null;
  version_validee_contenu: VersionRetour | null;
  historique: {
    version: number;
    origine: OrigineRetour;
    statut_contenu: StatutContenu;
    cree_par_nom: string | null;
    cree_le: string;
  }[];
}

export type NiveauEstimation = "contexte" | "brique" | "insuffisant";

export interface EstimationBrique {
  brique_code: string;
  niveau: NiveauEstimation;
  /** Absent (null) sous l'effectif minimum : jamais divulgué. */
  effectif_contexte: number | null;
  effectif_brique: number | null;
  facteurs_appliques: string[];
  /** Quartiles et extrêmes : null sous cinq observations. */
  resume: {
    effectif: number;
    min: number | null;
    q1: number | null;
    mediane: number;
    q3: number | null;
    max: number | null;
    atypiques: number | null;
  } | null;
  libelles: { mediane: string; q1: string | null; q3: string | null } | null;
}

export interface ReponseEstimation {
  effectif_minimum: number;
  tronque: boolean;
  elements: EstimationBrique[];
}

export interface GroupeDerogationsVue {
  cle: string;
  methode_code: string | null;
  brique_code: string;
  nature: string;
  missions: number;
  derogations: number;
  approuvees: number;
  refusees: number;
  demandees: number;
  motifs_visibles: number;
  mots_cles: { mot: string; occurrences: number }[];
  motifs: { representant: string; effectif: number }[];
  au_dessus_du_seuil: boolean;
  proposition: { id: string; statut: string; titre: string } | null;
}

export interface Competence {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  briques: string[];
  types_livrable: string[];
  active: boolean;
}

export interface CelluleCompetence {
  competence_id: string;
  niveau_valide: number | null;
  niveau_valide_le: string | null;
  niveau_en_attente: number | null;
  declaration_en_attente_id: string | null;
  /** Preuves, temps et dernier usage : absents de la matrice sans `budget.lire_jours`. */
  preuves?: number;
  centiemes?: number;
  jours?: string;
  derniere_preuve?: string | null;
  a_revoir: boolean;
}

export interface MatriceCompetences {
  competences: { id: string; code: string; libelle: string }[];
  lignes: {
    collaborateur: { id: string; nom: string; grade: string | null };
    cellules: CelluleCompetence[];
  }[];
}
