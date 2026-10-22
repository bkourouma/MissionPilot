/**
 * Ingestion de documents (lot 6, ADR-009) : types des vues de l'API, libellés, aides pures et
 * appels génériques, communs à DOS-03 (états financiers), DD-02 / DD-10 (due diligence) et
 * STD-13 (amorçage du standard). Aucune donnée de document n'est mise en cache dans le navigateur.
 *
 * Les chemins d'API et les appels (une configuration `ApiIngestion` par domaine : dossier, due
 * diligence, standard) sont dans `ingestion-api.ts`, réexporté ici. Ne calcule aucun chiffre métier.
 */
import {
  LIBELLES_ERREUR_INGESTION,
  LIBELLES_STATUT_EXTRACTION,
  LIBELLES_USAGE_INGESTION,
  PLAFONDS_INGESTION,
  type CodeErreurIngestion,
  type ContenuLecture,
  type ContenuProposition,
  type FormatIngestion,
  type MethodeExtraction,
  type ResultatIngestion,
  type StatutDocumentIngestion,
  type StatutExtraction,
  type UsageIngestion,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { messageErreur as messageErreurApi } from "./api";
import type { Personne } from "./dossier";

// --- Types renvoyés par l'API ----------------------------------------------------------------

export interface DocumentIngestion {
  id: string;
  usage: UsageIngestion;
  nom: string;
  format: FormatIngestion;
  taille: number;
  statut: StatutDocumentIngestion;
  resultat: ResultatIngestion | null;
  methode: MethodeExtraction | null;
  nb_pages: number | null;
  nb_caracteres: number | null;
  erreur_code: string | null;
  /** Message français déjà résolu par l'API. */
  erreur: string | null;
  etat_financier_id: string | null;
  parametres: Record<string, unknown>;
  cree_par: Personne;
  cree_le: string | null;
  termine_le: string | null;
  /** Date de la purge du texte des pages (conservation : 90 jours après la décision) ; null tant qu'il existe. */
  texte_purge_le: string | null;
}

export interface ResumePageIngestion {
  numero: number;
  nb_caracteres: number;
  methode: MethodeExtraction;
  confiance_pm: number | null;
}

export interface PageIngestion {
  numero: number;
  texte: string;
  methode: MethodeExtraction;
  confiance_pm: number | null;
}

interface ExtractionBase {
  id: string;
  document_id: string;
  statut: StatutExtraction;
  chiffres_non_verifies: boolean;
  cree_le: string | null;
  modifie_par: Personne | null;
  modifie_le: string | null;
  valide_par: Personne | null;
  valide_le: string | null;
  motif_rejet: string | null;
  resultat: Record<string, unknown> | null;
}

/** Extraction (brouillon IA) : le contenu dépend de la nature. */
export type ExtractionIngestion =
  | (ExtractionBase & { nature: "lecture_document"; contenu: ContenuLecture })
  | (ExtractionBase & { nature: "standard_proposition"; contenu: ContenuProposition });

export type ExtractionLecture = Extract<ExtractionIngestion, { nature: "lecture_document" }>;
export type ExtractionProposition = Extract<
  ExtractionIngestion,
  { nature: "standard_proposition" }
>;

export interface DetailDocumentIngestion extends DocumentIngestion {
  pages: ResumePageIngestion[];
  extractions: ExtractionIngestion[];
}

export interface PageDocumentsIngestion {
  elements: DocumentIngestion[];
  curseur_suivant: string | null;
}

// --- Libellés et tonalités -------------------------------------------------------------------

export const STATUTS_EN_COURS: readonly StatutDocumentIngestion[] = [
  "en_file",
  "extraction",
  "structuration",
];

export const STATUT_DOCUMENT: Record<
  StatutDocumentIngestion,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  en_file: { libelle: "En attente de lecture", tonalite: "neutre" },
  extraction: { libelle: "Lecture du texte en cours", tonalite: "attention" },
  structuration: { libelle: "Analyse en cours", tonalite: "attention" },
  termine: { libelle: "Terminé", tonalite: "succes" },
  echec: { libelle: "Échec", tonalite: "danger" },
};

export const LIBELLES_RESULTAT: Record<ResultatIngestion, string> = {
  etat_cree: "État financier créé",
  brouillon_cree: "Brouillon à relire",
  ia_indisponible: "IA indisponible : à relancer",
  rien_trouve: "Rien d'exploitable trouvé",
};

export const LIBELLES_METHODE: Record<MethodeExtraction, string> = {
  texte: "Texte du PDF",
  ocr_simule: "Reconnaissance de caractères (simulée)",
  tableur: "Classeur",
};

export const LIBELLES_FORMAT: Record<FormatIngestion, string> = { pdf: "PDF", xlsx: "Excel" };

export function libelleStatutDocument(s: StatutDocumentIngestion): string {
  return STATUT_DOCUMENT[s]?.libelle ?? s;
}

export function tonaliteStatutDocument(s: StatutDocumentIngestion): TonaliteStatut {
  return STATUT_DOCUMENT[s]?.tonalite ?? "neutre";
}

/** Résultat d'un document terminé ; « — » tant qu'il n'y en a pas. */
export function libelleResultat(r: ResultatIngestion | null | undefined): string {
  return r ? (LIBELLES_RESULTAT[r] ?? r) : "—";
}

/** Le texte des pages de ce document a été purgé (les références de page restent valables). */
export function textePurge(doc: { texte_purge_le?: string | null } | null | undefined): boolean {
  return Boolean(doc?.texte_purge_le);
}

export function libelleUsage(u: UsageIngestion): string {
  return LIBELLES_USAGE_INGESTION[u] ?? u;
}

export function libelleMethode(m: MethodeExtraction | null | undefined): string {
  return m ? (LIBELLES_METHODE[m] ?? m) : "—";
}

export function libelleStatutExtraction(s: StatutExtraction): string {
  return LIBELLES_STATUT_EXTRACTION[s] ?? s;
}

/** Message lisible d'un code d'erreur d'ingestion ; repli sur l'erreur interne pour un code inconnu. */
export function libelleErreurIngestion(code: string | null | undefined): string | null {
  if (!code) return null;
  return (
    LIBELLES_ERREUR_INGESTION[code as CodeErreurIngestion] ??
    LIBELLES_ERREUR_INGESTION.ERREUR_INTERNE
  );
}

/** Erreur d'un document : le message de l'API, sinon celui du code. */
export function erreurDocument(
  d: Pick<DocumentIngestion, "erreur" | "erreur_code">,
): string | null {
  return d.erreur ?? libelleErreurIngestion(d.erreur_code);
}

/** Document encore traité en arrière-plan : la page doit se rafraîchir. */
export function documentEnCours(d: Pick<DocumentIngestion, "statut">): boolean {
  return STATUTS_EN_COURS.includes(d.statut);
}

export function auMoinsUnEnCours(docs: readonly Pick<DocumentIngestion, "statut">[]): boolean {
  return docs.some(documentEnCours);
}

/** Taille lisible : « 850 o », « 12,5 Ko », « 1,2 Mo ». */
export function formaterTaille(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  const nf = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
  if (octets < 1024) return `${Math.round(octets)} o`;
  if (octets < 1024 * 1024) return `${nf(octets / 1024)} Ko`;
  return `${nf(octets / (1024 * 1024))} Mo`;
}

/** Confiance d'une page lue par reconnaissance de caractères (millièmes, « 87 % »), sinon « — ». */
export function formaterConfiancePage(pm: number | null | undefined): string {
  if (pm === null || pm === undefined || !Number.isFinite(pm)) return "—";
  return `${Math.round(Math.min(1000, Math.max(0, pm)) / 10)} %`;
}

/** Taille d'une page pour la liste : « 1 240 caractères ». */
export function formaterCaracteres(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(n)} caractère${n > 1 ? "s" : ""}`;
}

/** Message d'erreur affichable (français) d'un appel d'ingestion. */
export function messageErreur(e: unknown): string {
  return messageErreurApi(e);
}

// --- Contrôle du fichier côté client ---------------------------------------------------------

export const EXTENSIONS_INGESTION = [".pdf", ".xlsx"] as const;
export const ACCEPT_INGESTION = EXTENSIONS_INGESTION.join(",");

const MO = 1024 * 1024;
const mo = (octets: number) => Math.floor(octets / MO);

/** Format d'après l'extension (le contenu est décidé par l'API, jamais l'extension). */
export function formatDepuisNom(nom: string): FormatIngestion | null {
  const n = nom.trim().toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".xlsx")) return "xlsx";
  return null;
}

export function plafondTaille(format: FormatIngestion): number {
  return format === "pdf"
    ? PLAFONDS_INGESTION.tailleOctetsPdf
    : PLAFONDS_INGESTION.tailleOctetsXlsx;
}

export type ControleFichier =
  { ok: true; format: FormatIngestion } | { ok: false; message: string };

/** Extension .pdf / .xlsx, fichier non vide, plafonds de `PLAFONDS_INGESTION` (10 Mo PDF, 2 Mo Excel). */
export function controlerFichierIngestion(
  fichier: { name: string; size: number } | null | undefined,
): ControleFichier {
  if (!fichier) return { ok: false, message: "Choisissez un fichier PDF ou Excel (.xlsx)." };
  const format = formatDepuisNom(fichier.name);
  if (!format) {
    return { ok: false, message: "Format accepté : PDF (.pdf) ou classeur Excel (.xlsx)." };
  }
  if (fichier.size <= 0) return { ok: false, message: "Ce fichier est vide." };
  if (fichier.size > plafondTaille(format)) {
    return {
      ok: false,
      message: `Fichier trop volumineux : ${mo(plafondTaille(format))} Mo au plus pour un ${
        format === "pdf" ? "PDF" : "classeur Excel"
      } (celui-ci fait ${formaterTaille(fichier.size)}).`,
    };
  }
  return { ok: true, format };
}

/** Rappel des limites, affiché près du champ fichier. */
export function aideLimitesIngestion(): string {
  return (
    `PDF avec texte (${mo(PLAFONDS_INGESTION.tailleOctetsPdf)} Mo et ${PLAFONDS_INGESTION.pagesMax} pages au plus) ` +
    `ou classeur Excel .xlsx (${mo(PLAFONDS_INGESTION.tailleOctetsXlsx)} Mo au plus). ` +
    "Un PDF scanné (image sans texte) n'est pas lu."
  );
}

export * from "./ingestion-api";
