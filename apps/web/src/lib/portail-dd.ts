/**
 * Espace client (portail) pour les notes de due diligence communiquées à un investisseur. Logique
 * pure, testée dans `portail-dd.test.ts`.
 *
 * Règles : lecture seule ; une note publiée est une copie figée de la version validée par le
 * cabinet (jamais modifiable ici) ; aucun identifiant de dossier, de note, de mission ou de
 * rapport et aucun nom du cabinet n'est affiché. Le droit testé ici ne sert qu'à n'afficher que
 * ce qui sera accepté : l'API reste seule juge.
 */
import type {
  DdPortailPiece,
  DdPortailPublicationDetail,
  DdPortailPublicationResume,
  FormatRapportDd,
  RecommandationPubliee,
  VarianteRapportDd,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterDate } from "./format";
import { CHEMIN_PORTAIL } from "./portail-routes";

export type {
  DdPortailPiece,
  DdPortailPublicationDetail,
  DdPortailPublicationResume,
  RecommandationPubliee,
};

// --- Chemins ---------------------------------------------------------------------------------

const enc = encodeURIComponent;

/** Rubrique « Due diligence » de l'espace client. */
export const CHEMIN_DD_PORTAIL = `${CHEMIN_PORTAIL}/due-diligence`;
export const API_DD_PORTAIL = "/api/portail/due-diligence/publications";

export const hrefDdPortail = (id: string) => `${CHEMIN_DD_PORTAIL}/${enc(id)}`;
export const cheminApiDdPortail = (id: string) => `${API_DD_PORTAIL}/${enc(id)}`;

/** Téléchargement d'une pièce (binaire en pièce jointe, même origine, cookie de session). */
export const hrefPieceDdPortail = (publicationId: string, pieceId: string) =>
  `${cheminApiDdPortail(publicationId)}/pieces/${enc(pieceId)}/fichier`;

// --- Libellés --------------------------------------------------------------------------------

export const MENTION_LECTURE_SEULE = "Lecture seule";

export const MESSAGE_AUCUNE_NOTE = "Aucune note ne vous a été communiquée.";
export const AIDE_AUCUNE_NOTE =
  "Quand le cabinet vous communiquera une note de due diligence validée, elle apparaîtra ici.";

const RECOMMANDATIONS: Record<
  RecommandationPubliee,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  favorable: { libelle: "Favorable", tonalite: "succes" },
  favorable_sous_conditions: { libelle: "Favorable sous conditions", tonalite: "attention" },
  reservee: { libelle: "Réservée", tonalite: "attention" },
  defavorable: { libelle: "Défavorable", tonalite: "danger" },
};

/** Recommandation de la note ; une valeur inconnue reste neutre (jamais d'identifiant brut). */
export function etatRecommandationPortail(recommandation: string): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  return (
    RECOMMANDATIONS[recommandation as RecommandationPubliee] ?? {
      libelle: "Recommandation à préciser",
      tonalite: "neutre",
    }
  );
}

const VARIANTES: Record<VarianteRapportDd, string> = {
  executive: "Version exécutive",
  detaillee: "Version détaillée",
};

const FORMATS: Record<FormatRapportDd, string> = { pdf: "PDF", docx: "Word" };

export function libellePieceDdPortail(p: Pick<DdPortailPiece, "variante" | "format">): string {
  const variante = VARIANTES[p.variante] ?? "Document";
  const format = FORMATS[p.format] ?? String(p.format).toUpperCase();
  return `${variante} (${format})`;
}

export function mentionValidation(valideLe: string): string {
  return `Document validé par le cabinet le ${formaterDate(valideLe)}`;
}

export function mentionPublication(publieLe: string): string {
  return `Communiqué le ${formaterDate(publieLe)}`;
}

export function libellePiecesResume(nb: number): string {
  if (nb <= 0) return "Aucune pièce jointe";
  return nb === 1 ? "1 pièce à télécharger" : `${nb} pièces à télécharger`;
}

/** Ligne de détail d'une note de la liste (dates et pièces). */
export function resumeLigneDdPortail(
  p: Pick<DdPortailPublicationResume, "valide_le" | "publie_le" | "nb_pieces" | "version">,
): string {
  return `${mentionValidation(p.valide_le)} · ${mentionPublication(p.publie_le)} · version ${p.version} · ${libellePiecesResume(p.nb_pieces)}`;
}

// --- Lecture défensive des réponses ----------------------------------------------------------

/** Les conditions sont une liste de textes : toute valeur inattendue est écartée. */
export function conditionsDdPortail(conditions: unknown): string[] {
  if (!Array.isArray(conditions)) return [];
  return conditions.filter((c): c is string => typeof c === "string" && c.trim() !== "");
}

/** Une note communiquée sans pièce reste lisible : seul le texte est disponible. */
export function piecesDdPortail(pieces: unknown): DdPortailPiece[] {
  return Array.isArray(pieces) ? (pieces as DdPortailPiece[]) : [];
}
