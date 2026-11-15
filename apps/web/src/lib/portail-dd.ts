/**
 * Espace client (portail) pour les notes de due diligence communiquées à un investisseur. Logique
 * pure, testée dans `portail-dd.test.ts`.
 *
 * Règles : lecture seule ; une note publiée est une copie figée de la version validée par le
 * cabinet (jamais modifiable ici) ; aucun identifiant de dossier, de note, de mission ou de
 * rapport et aucun nom du cabinet n'est affiché. Le droit testé ici ne sert qu'à n'afficher que
 * ce qui sera accepté : l'API reste seule juge.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
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
export const MESSAGE_AUCUNE_NOTE_EN = "No note has been shared with you.";
export const AIDE_AUCUNE_NOTE_EN =
  "When the firm shares an approved due diligence note with you, it will appear here.";

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
const RECOMMANDATIONS_EN: Record<RecommandationPubliee, string> = {
  favorable: "Favorable",
  favorable_sous_conditions: "Favorable subject to conditions",
  reservee: "Reserved",
  defavorable: "Unfavorable",
};

export function etatRecommandationPortail(
  recommandation: string,
  langue: Langue = "fr",
): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  const base = RECOMMANDATIONS[recommandation as RecommandationPubliee];
  if (!base)
    return {
      libelle: creerTraduire(langue)("Recommandation à préciser", "Recommendation to be confirmed"),
      tonalite: "neutre",
    };
  return langue === "en"
    ? { ...base, libelle: RECOMMANDATIONS_EN[recommandation as RecommandationPubliee] }
    : base;
}

const VARIANTES: Record<VarianteRapportDd, string> = {
  executive: "Version exécutive",
  detaillee: "Version détaillée",
};

const FORMATS: Record<FormatRapportDd, string> = { pdf: "PDF", docx: "Word" };

const VARIANTES_EN: Record<VarianteRapportDd, string> = {
  executive: "Executive version",
  detaillee: "Detailed version",
};

export function libellePieceDdPortail(
  p: Pick<DdPortailPiece, "variante" | "format">,
  langue: Langue = "fr",
): string {
  const variante = (langue === "en" ? VARIANTES_EN : VARIANTES)[p.variante] ?? "Document";
  const format = FORMATS[p.format] ?? String(p.format).toUpperCase();
  return `${variante} (${format})`;
}

export function mentionValidation(valideLe: string, langue: Langue = "fr"): string {
  return creerTraduire(langue)(
    `Document validé par le cabinet le ${formaterDate(valideLe)}`,
    `Document approved by the firm on ${formaterDate(valideLe, "UTC", langue)}`,
  );
}

export function mentionPublication(publieLe: string, langue: Langue = "fr"): string {
  return creerTraduire(langue)(
    `Communiqué le ${formaterDate(publieLe)}`,
    `Shared on ${formaterDate(publieLe, "UTC", langue)}`,
  );
}

export function libellePiecesResume(nb: number, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (nb <= 0) return t("Aucune pièce jointe", "No attachments");
  return nb === 1
    ? t("1 pièce à télécharger", "1 file to download")
    : t(`${nb} pièces à télécharger`, `${nb} files to download`);
}

/** Ligne de détail d'une note de la liste (dates et pièces). */
export function resumeLigneDdPortail(
  p: Pick<DdPortailPublicationResume, "valide_le" | "publie_le" | "nb_pieces" | "version">,
  langue: Langue = "fr",
): string {
  return `${mentionValidation(p.valide_le, langue)} · ${mentionPublication(p.publie_le, langue)} · ${creerTraduire(langue)("version", "version")} ${p.version} · ${libellePiecesResume(p.nb_pieces, langue)}`;
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
