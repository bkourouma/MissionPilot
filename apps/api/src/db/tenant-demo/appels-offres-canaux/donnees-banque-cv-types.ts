import type { CleCollaborateur } from "../cles.js";

/*
 * Banque de CV du Tenant démo : 8 profils de consultants du cabinet (personnes FICTIVES), chacun
 * avec une version initiale et une ou deux mises à jour datées (expérience ajoutée, certification,
 * langue). Employeurs et diplômes sont fictifs. Les mois sont au format AAAA-MM.
 */

export interface ExperienceCv {
  intitule: string;
  employeur: string;
  pays: string;
  debut: string;
  fin: string | null;
  secteurs: string[];
  bailleur?: string;
  description: string;
}

export interface DiplomeCv {
  intitule: string;
  niveau: "bac_3" | "bac_4" | "bac_5" | "doctorat";
  domaine: string;
  etablissement: string;
  annee: number;
}

export interface ContenuCvDemo {
  titre: string;
  nationalite: string;
  resume: string;
  secteurs: string[];
  competences: string[];
  experiences: ExperienceCv[];
  diplomes: DiplomeCv[];
  langues: { langue: string; niveau: "notions" | "courant" | "bilingue" | "maternelle" }[];
}

/** Mise à jour d'un CV : nouvelle version avec motif (expérience en tête, compétences ajoutées). */
export interface MajCv {
  motif: string;
  titre?: string;
  experience?: ExperienceCv;
  competences?: string[];
  langues?: ContenuCvDemo["langues"];
}

export interface CvDemo {
  cle: CleCollaborateur;
  /** Nom du profil quand le compte n'en porte pas (ancien collaborateur). */
  nom?: string;
  contenu: ContenuCvDemo;
  majs: MajCv[];
}

export const exp = (
  intitule: string,
  employeur: string,
  pays: string,
  debut: string,
  fin: string | null,
  secteurs: string[],
  description: string,
  bailleur?: string,
): ExperienceCv => ({
  intitule,
  employeur,
  pays,
  debut,
  fin,
  secteurs,
  description,
  ...(bailleur ? { bailleur } : {}),
});

export const CABINET = "Tenant démo";
export const FR_EN = [
  { langue: "français", niveau: "maternelle" as const },
  { langue: "anglais", niveau: "courant" as const },
];
