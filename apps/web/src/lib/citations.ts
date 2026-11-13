/**
 * Citations cliquables des livrables web (PRV-06) : contrats des réponses de l'API, renvois
 * « [1], [2] », ancres, liens d'ouverture et libellés. Logique pure, testée dans `citations.test.ts`.
 *
 * La numérotation [n] est celle de l'API (identique à l'annexe « Sources » des exports PDF et Word)
 * et la solidité vient du moteur : ce module les met en forme et ne les recalcule JAMAIS.
 * L'appel serveur est dans `citations-serveur.ts`.
 */
import {
  LIVRABLE_CITATION_LIBELLES,
  LIVRABLES_CITATION,
  type Langue,
  type LectureSoliditeApi,
  type LivrableCitation,
} from "@missionpilot/shared";
import {
  formaterIndice,
  libelleFiabiliteApi,
  libelleLecture,
  libelleTypeSourcePreuve,
} from "./preuves";

export { LIVRABLE_CITATION_LIBELLES, LIVRABLES_CITATION };
export type { LivrableCitation };

// --- Réponses de l'API ----------------------------------------------------------------------

export interface AssertionCiteeVue {
  id: string;
  enonce: string;
  solidite: { lecture: LectureSoliditeApi; indice: number } | null;
  avis_expert_signe: boolean;
  renvois: { pour: number[]; contre: number[] };
}

export interface SourceCiteeVue {
  numero: number;
  preuve_id: string;
  type_source: string;
  source_precise: string;
  date_preuve: string;
  fiabilite: string;
  extrait: string | null;
  masque: boolean;
}

export interface SourcesLivrableVue {
  livrable: LivrableCitation;
  assertions: AssertionCiteeVue[];
  sources: SourceCiteeVue[];
}

// --- Libellés -------------------------------------------------------------------------------

export const MESSAGE_VERBATIM_MASQUE =
  "Verbatim nominatif masqué : accord de la personne non recueilli";

export const MESSAGE_VERBATIM_MASQUE_EN =
  "Named verbatim hidden: the person's consent was not obtained";

export const TITRE_SECTION_CITATIONS = "Sources et citations";
export const TITRE_SECTION_CITATIONS_EN = "Sources and citations";

export const messageVerbatimMasque = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_VERBATIM_MASQUE_EN : MESSAGE_VERBATIM_MASQUE;
export const titreSectionCitations = (langue: Langue = "fr") =>
  langue === "en" ? TITRE_SECTION_CITATIONS_EN : TITRE_SECTION_CITATIONS;

const LIVRABLE_CITATION_LIBELLES_EN: Record<LivrableCitation, string> = {
  notation: "Rating",
  plan: "Strategic plan",
};
export const libelleLivrableCitation = (l: LivrableCitation, langue: Langue = "fr") =>
  (langue === "en" ? LIVRABLE_CITATION_LIBELLES_EN : LIVRABLE_CITATION_LIBELLES)[l];

/** Le segment d'URL désigne-t-il un livrable cité ? */
export function estLivrableCitation(v: string): v is LivrableCitation {
  return (LIVRABLES_CITATION as readonly string[]).includes(v);
}

/** Libellé du type de source ; une valeur inconnue de cette version du web est affichée telle quelle. */
export function libelleTypeSource(type: string, langue: Langue = "fr"): string {
  return libelleTypeSourcePreuve(type, langue);
}

/** « Solide (0,875) » ; « Non évaluée » sans évaluation. Le texte porte seul le sens. */
export function libelleSoliditeCitee(
  s: AssertionCiteeVue["solidite"],
  langue: Langue = "fr",
): string {
  if (!s) return langue === "en" ? "Not rated" : "Non évaluée";
  const lecture = libelleLecture(s.lecture, langue);
  return `${lecture} (${formaterIndice(s.indice)})`;
}

/** « [1], [2] » ; chaîne vide sans renvoi. */
export function formaterRenvois(numeros: readonly number[]): string {
  return numeros.map((n) => `[${n}]`).join(", ");
}

/** « contre : [3] » ; chaîne vide sans renvoi. */
export function formaterRenvoisContre(numeros: readonly number[], langue: Langue = "fr"): string {
  return numeros.length > 0
    ? `${langue === "en" ? "against" : "contre"} : ${formaterRenvois(numeros)}`
    : "";
}

/** Phrase d'accessibilité d'un renvoi : « Source 3 : Entretien, Compte rendu du 12 mars ». */
export function nomAccessibleRenvoi(
  numero: number,
  source: SourceCiteeVue | undefined,
  langue: Langue = "fr",
): string {
  return source
    ? `Source ${numero} : ${libelleTypeSource(source.type_source, langue)}, ${source.source_precise}`
    : `Source ${numero}`;
}

// --- Chemins et liens -----------------------------------------------------------------------

export const cheminSourcesLivrable = (missionId: string, livrable: LivrableCitation) =>
  `/api/missions/${missionId}/livrables/${livrable}/sources`;
export const cheminSourceCitee = (
  missionId: string,
  livrable: LivrableCitation,
  preuveId: string,
) => `${cheminSourcesLivrable(missionId, livrable)}/${preuveId}`;

/** Ancre de la source numérotée dans la liste de la section. */
export const ancreSource = (numero: number) => `source-${numero}`;
export const hrefAncreSource = (numero: number) => `#${ancreSource(numero)}`;

/** Page d'ouverture d'une citation (droits revérifiés par l'API). */
export const hrefOuvertureCitation = (
  missionId: string,
  livrable: LivrableCitation,
  preuveId: string,
) => `/missions/${missionId}/preuves/citations/${livrable}/${preuveId}`;

/** Retour vers le livrable qui cite. */
export const hrefLivrableCitant = (missionId: string, livrable: LivrableCitation) =>
  livrable === "plan" ? `/missions/${missionId}/plan` : `/missions/${missionId}/notation`;

export const libelleRetourLivrable = (livrable: LivrableCitation, langue: Langue = "fr") =>
  langue === "en"
    ? livrable === "plan"
      ? "Back to the strategic plan"
      : "Back to the rating"
    : livrable === "plan"
      ? "Revenir au plan stratégique"
      : "Revenir à la notation";

/** Numéro [n] → source, pour nommer les renvois. */
export function indexerSources(sources: readonly SourceCiteeVue[]): Map<number, SourceCiteeVue> {
  return new Map(sources.map((s) => [s.numero, s]));
}

/** « A · Très fiable » ; une valeur inconnue est affichée telle quelle. */
export function libelleFiabiliteSource(fiabilite: string, langue: Langue = "fr"): string {
  return libelleFiabiliteApi(fiabilite, langue);
}
