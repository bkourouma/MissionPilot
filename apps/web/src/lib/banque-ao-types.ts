import type {
  LIBELLES_ROLE_REFERENCE,
  LIBELLES_TYPE_ATTESTATION,
  NiveauDiplomeAo,
  NiveauLangueAo,
  SectionOffreTechnique,
} from "@missionpilot/shared";
import type { Devise } from "./format";

export const RACINE_BANQUES = "/appels-offres/banques";

/* ----- Types des réponses ----- */

export interface ExperienceSaisie {
  intitule: string;
  employeur: string;
  pays?: string | null;
  debut: string;
  fin: string | null;
  secteurs: string[];
  bailleur?: string | null;
  description?: string | null;
}

export interface DiplomeSaisi {
  intitule: string;
  niveau: NiveauDiplomeAo;
  domaine: string;
  etablissement?: string | null;
  annee: number;
}

export interface LangueSaisie {
  langue: string;
  niveau: NiveauLangueAo;
}

export interface ContenuCv {
  titre: string;
  nationalite?: string | null;
  resume?: string | null;
  secteurs: string[];
  competences: string[];
  experiences: ExperienceSaisie[];
  diplomes: DiplomeSaisi[];
  langues: LangueSaisie[];
}

export interface CvResume {
  id: string;
  numero: number;
  nom: string;
  collaborateur_id: string | null;
  /** Vrai une fois le CV anonymisé : plus utilisable dans une offre. */
  anonymise?: boolean;
  version: number;
  titre: string;
  secteurs: string[];
  annees_experience: number;
}

export interface CvDetail {
  id: string;
  numero: number;
  nom: string;
  collaborateur_id: string | null;
  collaborateur_nom: string | null;
  /** Vrai une fois le CV anonymisé (irréversible) : ni export, ni nouvelle version. */
  anonymise: boolean;
  reference: string;
  annees_experience: number;
  courante: { version: number; contenu: ContenuCv; motif: string | null; cree_le: string };
  versions: { id: string; version: number; motif: string | null; cree_le: string }[];
}

export interface GabaritCv {
  code: string;
  libelle: string;
  bailleur: string;
  standard: boolean;
}

export interface CritereControle {
  code: string;
  objet: string | null;
  exige: string;
  constate: string;
  conforme: boolean;
}

export interface ResultatControle {
  conforme: boolean;
  annees_experience: number;
  reference: string;
  criteres: CritereControle[];
}

export interface VersionReference {
  version: number;
  titre: string;
  client_nom: string;
  pays: string;
  secteurs: string[];
  bailleur: string | null;
  montant: number;
  devise: Devise;
  date_debut: string;
  date_fin: string | null;
  role_cabinet: keyof typeof LIBELLES_ROLE_REFERENCE;
  description: string | null;
  motif: string | null;
  cree_le: string;
}

export interface ReferenceResume extends VersionReference {
  id: string;
  numero: number;
  attestations: number;
}

export interface Attestation {
  id: string;
  type: keyof typeof LIBELLES_TYPE_ATTESTATION;
  date_attestation: string;
  emetteur: string;
  retiree: boolean;
  motif_retrait: string | null;
  fichier: { id: string; nom: string; type_mime: string; taille: number };
}

export interface ReferenceDetail {
  id: string;
  numero: number;
  courante: VersionReference;
  versions: VersionReference[];
  attestations: Attestation[];
}

export type StatutOffreTechnique = "brouillon_ia" | "modifiee" | "validee";
export type SectionsOffre = Record<SectionOffreTechnique, string>;

export interface VersionOffreTechnique {
  id: string;
  version: number;
  sections: SectionsOffre;
  origine: "ia" | "gabarit" | "manuel";
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  motif: string | null;
  cree_le: string;
  validation: { valide_par: string; acquitte_chiffres: boolean; valide_le: string } | null;
}

export interface OffreTechniqueResume {
  id: string;
  numero: number;
  appel_offres_id: string | null;
  titre: string;
  version: number;
  statut: StatutOffreTechnique;
  cree_le: string;
}

export interface OffreTechniqueDetail {
  id: string;
  numero: number;
  appel_offres_id: string | null;
  titre: string;
  statut: StatutOffreTechnique;
  /**
   * Faux quand l'utilisateur courant a demandé ou rédigé l'offre (séparation des tâches, sauf
   * associé) : le bouton « Valider » est alors désactivé ; l'API reste seule juge.
   */
  peut_valider: boolean;
  courante: VersionOffreTechnique | null;
  versions: VersionOffreTechnique[];
}

export interface LigneResultat {
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  montant: number;
  cle?: string;
}

export interface ResultatOffreFinanciere {
  devise: Devise;
  honoraires: LigneResultat[];
  per_diem: LigneResultat[];
  debours: LigneResultat[];
  jours_par_expert: { cle: string; libelle: string; jours_centiemes: number; montant: number }[];
  total_jours_centiemes: number;
  sous_total_honoraires: number;
  sous_total_per_diem: number;
  sous_total_debours: number;
  total_ht: number;
  taxes: { libelle: string; taux: number; assiette: string; base: number; montant: number }[];
  total_taxes: number;
  total_ttc: number;
  conversion: {
    devise_cible: Devise;
    taux: number;
    date_fixation: string;
    total_ht: number;
    total_ttc: number;
  } | null;
}

export interface OffreFinanciereResume {
  id: string;
  numero: number;
  titre: string;
  version: number;
  devise: Devise;
  total_ht: number;
  total_ttc: number;
  cree_le: string;
}

export interface OffreFinanciereDetail {
  id: string;
  numero: number;
  titre: string;
  courante: {
    version: number;
    devise: Devise;
    entree: Record<string, unknown>;
    resultat: ResultatOffreFinanciere;
    motif: string | null;
    cree_le: string;
  } | null;
  versions: { version: number; motif: string | null; cree_le: string }[];
}
