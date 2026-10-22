import {
  NIVEAU_COMPETENCE_LIBELLES,
  TYPE_RESULTAT_LIBELLES,
  type OrigineRetour,
  type SectionRetour,
  type TypeResultatRecherche,
} from "@missionpilot/shared";
import type { NiveauEstimation, RetourDetail, StatutContenu } from "./capitalisation-types";

/** Libellés de la rubrique « Connaissances ». */

/* ----- Libellés ----- */

export const libelleTypeResultat = (t: TypeResultatRecherche) => TYPE_RESULTAT_LIBELLES[t];

const ORIGINES: Record<OrigineRetour, string> = {
  gabarit: "Brouillon automatique",
  ia: "Brouillon IA",
  humain: "Rédaction",
};
export const libelleOrigine = (o: OrigineRetour) => ORIGINES[o];

const STATUTS_CONTENU: Record<StatutContenu, string> = {
  brouillon_ia: "Brouillon à relire",
  modifie: "Modifié",
  valide: "Validé",
};
export const libelleStatutContenu = (s: StatutContenu) => STATUTS_CONTENU[s];

export function tonaliteStatutRetour(statut: RetourDetail["statut"]): "succes" | "attention" {
  return statut === "valide" ? "succes" : "attention";
}

const SECTIONS: Record<SectionRetour, string> = {
  contexte: "Contexte",
  methode: "Méthode",
  ecarts: "Écarts",
  lecons: "Leçons",
};
export const libelleSection = (s: SectionRetour) => SECTIONS[s];

const NIVEAUX_ESTIMATION: Record<NiveauEstimation, string> = {
  contexte: "Missions du même contexte",
  brique: "Toutes les missions de la brique",
  insuffisant: "Historique insuffisant",
};
export const libelleNiveauEstimation = (n: NiveauEstimation) => NIVEAUX_ESTIMATION[n];

const NATURES: Record<string, string> = {
  retirer_brique: "Retrait",
  activer_brique: "Activation",
  adapter_brique: "Adaptation",
};
export const libelleNature = (n: string) => NATURES[n] ?? n;

export function libelleNiveauCompetence(n: number | null): string {
  if (n === null) return "—";
  return `${n} · ${NIVEAU_COMPETENCE_LIBELLES[n] ?? "?"}`;
}
