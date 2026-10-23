import {
  DECISION_ARBITRAGE_LIBELLES,
  FIABILITE_LIBELLES,
  LECTURE_SOLIDITE_LIBELLES,
  RATTACHEMENT_LIBELLES,
  STATUT_ASSERTION_LIBELLES,
  TYPE_SOURCE_PREUVE_LIBELLES,
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

export function libelleLecture(lecture: LectureSoliditeApi): string {
  return LECTURES[lecture];
}
