import {
  CLASSE_RISQUE_LIBELLES,
  DECISION_ARBITRAGE_LIBELLES,
  FIABILITE_LIBELLES,
  LECTURE_SOLIDITE_LIBELLES,
  RATTACHEMENT_LIBELLES,
  STATUT_ASSERTION_LIBELLES,
  TYPE_SOURCE_PREUVE_LIBELLES,
  type Langue,
  type LectureSoliditeApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { SensApi } from "./preuves-types";

// --- Libellés -------------------------------------------------------------------------------

export const TYPE_SOURCE_LIBELLES = TYPE_SOURCE_PREUVE_LIBELLES;
export const FIABILITES = FIABILITE_LIBELLES;
export const LECTURES = LECTURE_SOLIDITE_LIBELLES;
export const STATUTS_ASSERTION = STATUT_ASSERTION_LIBELLES;
export const RATTACHEMENTS = RATTACHEMENT_LIBELLES;
export const DECISIONS = DECISION_ARBITRAGE_LIBELLES;

export const SENS_LIBELLES: Record<SensApi, string> = { pour: "Pour", contre: "Contre" };

export const ANOMALIE_LIBELLES: Record<"SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE", string> = {
  SANS_PREUVE: "Aucune preuve en sa faveur ni avis d'expert",
  AVIS_EXPERT_NON_SIGNE: "Avis d'expert non signé",
};

/** Lecture du moteur → tonalité du badge (le texte est toujours affiché). */
export const TONALITE_LECTURE: Record<LectureSoliditeApi, TonaliteStatut> = {
  solide: "succes",
  etayee: "attention",
  fragile: "danger",
};

export function libelleLecture(lecture: LectureSoliditeApi, langue: Langue = "fr"): string {
  return (langue === "en" ? LECTURES_EN : LECTURES)[lecture];
}

// --- Libellés en anglais (le français ci-dessus reste la référence) -------------------------

export const TYPE_SOURCE_LIBELLES_EN: Record<keyof typeof TYPE_SOURCE_PREUVE_LIBELLES, string> = {
  questionnaire: "Questionnaire",
  entretien: "Interview",
  observation: "Field observation",
  document: "Document",
  donnee_externe: "External data",
};

export const FIABILITES_EN: Record<keyof typeof FIABILITE_LIBELLES, string> = {
  A: "A · Highly reliable",
  B: "B · Reliable",
  C: "C · Moderately reliable",
  D: "D · Low reliability",
};

export const LECTURES_EN: Record<LectureSoliditeApi, string> = {
  solide: "Solid",
  etayee: "Supported",
  fragile: "Fragile",
};

export const STATUTS_ASSERTION_EN: Record<keyof typeof STATUT_ASSERTION_LIBELLES, string> = {
  brouillon: "Draft",
  retenue: "Retained",
  abandonnee: "Dropped",
};

export const RATTACHEMENTS_EN: Record<keyof typeof RATTACHEMENT_LIBELLES, string> = {
  dimension: "Dimension",
  hypothese: "Hypothesis",
  risque: "Risk",
};

export const DECISIONS_EN: Record<keyof typeof DECISION_ARBITRAGE_LIBELLES, string> = {
  contradiction_levee: "Contradiction resolved (the opposing evidence is set aside)",
  contradiction_maintenue: "Contradiction upheld (acknowledged, the assertion is qualified)",
};

export const SENS_LIBELLES_EN: Record<SensApi, string> = { pour: "For", contre: "Against" };

export const ANOMALIE_LIBELLES_EN: Record<"SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE", string> = {
  SANS_PREUVE: "No supporting evidence or expert opinion",
  AVIS_EXPERT_NON_SIGNE: "Expert opinion not signed",
};

/** Libellé dans la langue demandée ; une valeur inconnue de cette version du web est rendue telle quelle. */
function choisir(
  fr: Record<string, string>,
  en: Record<string, string>,
  cle: string,
  langue: Langue,
) {
  return (langue === "en" ? en : fr)[cle] ?? cle;
}

export const libelleTypeSourcePreuve = (type: string, langue: Langue = "fr") =>
  choisir(TYPE_SOURCE_LIBELLES, TYPE_SOURCE_LIBELLES_EN, type, langue);
export const libelleFiabiliteApi = (f: string, langue: Langue = "fr") =>
  choisir(FIABILITES, FIABILITES_EN, f, langue);
export const libelleStatutAssertion = (s: string, langue: Langue = "fr") =>
  choisir(STATUTS_ASSERTION, STATUTS_ASSERTION_EN, s, langue);
export const libelleRattachement = (r: string, langue: Langue = "fr") =>
  choisir(RATTACHEMENTS, RATTACHEMENTS_EN, r, langue);
export const libelleDecision = (d: string, langue: Langue = "fr") =>
  choisir(DECISIONS, DECISIONS_EN, d, langue);
export const libelleSens = (s: SensApi, langue: Langue = "fr") =>
  choisir(SENS_LIBELLES, SENS_LIBELLES_EN, s, langue);
export const libelleAnomalie = (
  code: "SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE",
  langue: Langue = "fr",
) => choisir(ANOMALIE_LIBELLES, ANOMALIE_LIBELLES_EN, code, langue);

const CLASSE_RISQUE_LIBELLES_EN: Record<keyof typeof CLASSE_RISQUE_LIBELLES, string> = {
  R0: "Internal operations",
  R1: "Internal analysis",
  R2: "Client deliverable",
  R3: "Binding",
};
export const libelleClasseRisque = (
  c: keyof typeof CLASSE_RISQUE_LIBELLES,
  langue: Langue = "fr",
) => `${c} · ${(langue === "en" ? CLASSE_RISQUE_LIBELLES_EN : CLASSE_RISQUE_LIBELLES)[c]}`;
