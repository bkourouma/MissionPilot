import {
  NIVEAU_COMPETENCE_LIBELLES,
  TYPE_RESULTAT_LIBELLES,
  type Langue,
  type OrigineRetour,
  type SectionRetour,
  type TypeResultatRecherche,
} from "@missionpilot/shared";
import type { NiveauEstimation, RetourDetail, StatutContenu } from "./capitalisation-types";

/** Libellés de la rubrique « Connaissances ». */

/* ----- Libellés ----- */

const TYPE_RESULTAT_LIBELLES_EN: Record<TypeResultatRecherche, string> = {
  mission: "Engagement",
  livrable: "Deliverable",
  rapport: "Report",
  preuve: "Evidence",
  connaissance: "Lessons learned",
};
export const libelleTypeResultat = (t: TypeResultatRecherche, langue: Langue = "fr") =>
  (langue === "en" ? TYPE_RESULTAT_LIBELLES_EN : TYPE_RESULTAT_LIBELLES)[t];

const ORIGINES: Record<OrigineRetour, string> = {
  gabarit: "Brouillon automatique",
  ia: "Brouillon IA",
  humain: "Rédaction",
};
const ORIGINES_EN: Record<OrigineRetour, string> = {
  gabarit: "Automatic draft",
  ia: "AI draft",
  humain: "Written by a person",
};
export const libelleOrigine = (o: OrigineRetour, langue: Langue = "fr") =>
  (langue === "en" ? ORIGINES_EN : ORIGINES)[o];

const STATUTS_CONTENU: Record<StatutContenu, string> = {
  brouillon_ia: "Brouillon à relire",
  modifie: "Modifié",
  valide: "Validé",
};
const STATUTS_CONTENU_EN: Record<StatutContenu, string> = {
  brouillon_ia: "Draft to review",
  modifie: "Edited",
  valide: "Approved",
};
export const libelleStatutContenu = (s: StatutContenu, langue: Langue = "fr") =>
  (langue === "en" ? STATUTS_CONTENU_EN : STATUTS_CONTENU)[s];

export function tonaliteStatutRetour(statut: RetourDetail["statut"]): "succes" | "attention" {
  return statut === "valide" ? "succes" : "attention";
}

const SECTIONS: Record<SectionRetour, string> = {
  contexte: "Contexte",
  methode: "Méthode",
  ecarts: "Écarts",
  lecons: "Leçons",
};
const SECTIONS_EN: Record<SectionRetour, string> = {
  contexte: "Context",
  methode: "Method",
  ecarts: "Variances",
  lecons: "Lessons",
};
export const libelleSection = (s: SectionRetour, langue: Langue = "fr") =>
  (langue === "en" ? SECTIONS_EN : SECTIONS)[s];

const NIVEAUX_ESTIMATION: Record<NiveauEstimation, string> = {
  contexte: "Missions du même contexte",
  brique: "Toutes les missions de la brique",
  insuffisant: "Historique insuffisant",
};
const NIVEAUX_ESTIMATION_EN: Record<NiveauEstimation, string> = {
  contexte: "Engagements in the same context",
  brique: "All engagements of the building block",
  insuffisant: "Insufficient history",
};
export const libelleNiveauEstimation = (n: NiveauEstimation, langue: Langue = "fr") =>
  (langue === "en" ? NIVEAUX_ESTIMATION_EN : NIVEAUX_ESTIMATION)[n];

const NATURES: Record<string, string> = {
  retirer_brique: "Retrait",
  activer_brique: "Activation",
  adapter_brique: "Adaptation",
};
const NATURES_EN: Record<string, string> = {
  retirer_brique: "Removal",
  activer_brique: "Activation",
  adapter_brique: "Adaptation",
};
export const libelleNature = (n: string, langue: Langue = "fr") =>
  (langue === "en" ? NATURES_EN : NATURES)[n] ?? n;

const NIVEAU_COMPETENCE_LIBELLES_EN: Record<number, string> = {
  1: "Awareness",
  2: "Practice",
  3: "Proficiency",
  4: "Expertise",
};

export function libelleNiveauCompetence(n: number | null, langue: Langue = "fr"): string {
  if (n === null) return "—";
  const table = langue === "en" ? NIVEAU_COMPETENCE_LIBELLES_EN : NIVEAU_COMPETENCE_LIBELLES;
  return `${n} · ${table[n] ?? "?"}`;
}
