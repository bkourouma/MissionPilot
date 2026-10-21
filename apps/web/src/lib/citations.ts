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
  type LectureSoliditeApi,
  type LivrableCitation,
} from "@missionpilot/shared";
import { FIABILITES, formaterIndice, libelleLecture, TYPE_SOURCE_LIBELLES } from "./preuves";

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

export const TITRE_SECTION_CITATIONS = "Sources et citations";

/** Le segment d'URL désigne-t-il un livrable cité ? */
export function estLivrableCitation(v: string): v is LivrableCitation {
  return (LIVRABLES_CITATION as readonly string[]).includes(v);
}

/** Libellé du type de source ; une valeur inconnue de cette version du web est affichée telle quelle. */
export function libelleTypeSource(type: string): string {
  return (TYPE_SOURCE_LIBELLES as Record<string, string>)[type] ?? type;
}

/** « Solide (0,875) » ; « Non évaluée » sans évaluation. Le texte porte seul le sens. */
export function libelleSoliditeCitee(s: AssertionCiteeVue["solidite"]): string {
  if (!s) return "Non évaluée";
  const lecture = libelleLecture(s.lecture);
  return `${lecture} (${formaterIndice(s.indice)})`;
}

/** « [1], [2] » ; chaîne vide sans renvoi. */
export function formaterRenvois(numeros: readonly number[]): string {
  return numeros.map((n) => `[${n}]`).join(", ");
}

/** « contre : [3] » ; chaîne vide sans renvoi. */
export function formaterRenvoisContre(numeros: readonly number[]): string {
  return numeros.length > 0 ? `contre : ${formaterRenvois(numeros)}` : "";
}

/** Phrase d'accessibilité d'un renvoi : « Source 3 : Entretien, Compte rendu du 12 mars ». */
export function nomAccessibleRenvoi(numero: number, source: SourceCiteeVue | undefined): string {
  return source
    ? `Source ${numero} : ${libelleTypeSource(source.type_source)}, ${source.source_precise}`
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

export const libelleRetourLivrable = (livrable: LivrableCitation) =>
  livrable === "plan" ? "Revenir au plan stratégique" : "Revenir à la notation";

/** Numéro [n] → source, pour nommer les renvois. */
export function indexerSources(sources: readonly SourceCiteeVue[]): Map<number, SourceCiteeVue> {
  return new Map(sources.map((s) => [s.numero, s]));
}

/** « A · Très fiable » ; une valeur inconnue est affichée telle quelle. */
export function libelleFiabiliteSource(fiabilite: string): string {
  return (FIABILITES as Record<string, string>)[fiabilite] ?? fiabilite;
}
