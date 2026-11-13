/**
 * Ingestion de documents (lot 6, ADR-009) : types des vues de l'API, libellés, aides pures et
 * appels génériques, communs à DOS-03 (états financiers), DD-02 / DD-10 (due diligence) et
 * STD-13 (amorçage du standard). Aucune donnée de document n'est mise en cache dans le navigateur.
 *
 * Les chemins d'API et les appels (une configuration `ApiIngestion` par domaine : dossier, due
 * diligence, standard) sont dans `ingestion-api.ts`, réexporté ici. Ne calcule aucun chiffre métier.
 */
import {
  LIBELLES_CONFUSION_OCR,
  LIBELLES_ERREUR_INGESTION,
  LIBELLES_STATUT_EXTRACTION,
  LIBELLES_USAGE_INGESTION,
  PLAFONDS_INGESTION,
  PLAFONDS_OCR,
  LOCALES_INTL,
  creerTraduire,
  type CodeErreurIngestion,
  type ConfusionOcr,
  type CorrectionOcr,
  type ContenuLecture,
  type ContenuProposition,
  type FormatIngestion,
  type Langue,
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
  /** Montants que la tolérance aux confusions de lecture propose de corriger (OCR) ; null hors OCR. */
  corrections_ocr?: CorrectionOcr[] | null;
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

export const STATUT_DOCUMENT_EN: Record<
  StatutDocumentIngestion,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  en_file: { libelle: "Waiting to be read", tonalite: "neutre" },
  extraction: { libelle: "Reading text", tonalite: "attention" },
  structuration: { libelle: "Analysis in progress", tonalite: "attention" },
  termine: { libelle: "Completed", tonalite: "succes" },
  echec: { libelle: "Failed", tonalite: "danger" },
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
  ocr: "Reconnaissance de caractères (OCR local)",
  tableur: "Classeur",
};

export const LIBELLES_RESULTAT_EN: Record<ResultatIngestion, string> = {
  etat_cree: "Financial statement created",
  brouillon_cree: "Draft to review",
  ia_indisponible: "AI unavailable: to be rerun",
  rien_trouve: "Nothing usable found",
};

export const LIBELLES_METHODE_EN: Record<MethodeExtraction, string> = {
  texte: "PDF text",
  ocr_simule: "Character recognition (simulated)",
  ocr: "Character recognition (local OCR)",
  tableur: "Workbook",
};

const LIBELLES_USAGE_EN: Record<UsageIngestion, string> = {
  etat_financier: "Financial statement",
  dd_rapport: "Report (due diligence)",
  dd_salle: "Data room (due diligence)",
  standard_historique: "Historical document (framework seeding)",
};

const LIBELLES_STATUT_EXTRACTION_EN: Record<StatutExtraction, string> = {
  brouillon_ia: "AI draft",
  modifie: "Edited",
  valide: "Approved",
  rejete: "Rejected",
};

const LIBELLES_ERREUR_INGESTION_EN: Record<CodeErreurIngestion, string> = {
  PDF_ILLISIBLE: "The PDF is unreadable or protected.",
  PDF_SANS_TEXTE:
    "No text could be read in this document (blank or unreadable page). Provide a PDF with text or a sharper scan.",
  OCR_NON_SIMULE: "Simulated character recognition only reads its own test documents.",
  OCR_INDISPONIBLE:
    "Scanned document: character recognition is not available on this server. Provide a PDF with text or ask the administrator to enable scan reading.",
  OCR_ECHEC: "Character recognition of the scan failed. Provide a PDF with text or a sharper scan.",
  IMAGE_TROP_GRANDE: "An image in the document exceeds the size allowed for character recognition.",
  PLAFOND_PAGES: "The document exceeds the allowed number of pages.",
  PLAFOND_TEXTE: "The document text exceeds the allowed size.",
  DELAI_DEPASSE: "Reading the document exceeded the allowed time.",
  TABLEUR_ILLISIBLE: "The workbook is unreadable.",
  FICHIER_ABSENT: "The uploaded file is no longer available: upload it again.",
  UTILISATEUR_INACTIF: "The user who uploaded the file is no longer active.",
  DOSSIER_INACCESSIBLE: "The file is no longer accessible to the user who uploaded the document.",
  ETAT_INVALIDE: "The lines read do not form a usable statement.",
  ERREUR_INTERNE: "Internal error: try again later.",
};

const LIBELLES_CONFUSION_OCR_EN: Record<ConfusionOcr, string> = {
  o_zero: "letter O read for the digit 0",
  l_un: "letter l or I read for the digit 1",
  separateur: "comma and period confused",
};

export const LIBELLES_FORMAT: Record<FormatIngestion, string> = { pdf: "PDF", xlsx: "Excel" };

export function libelleStatutDocument(s: StatutDocumentIngestion, langue: Langue = "fr"): string {
  return (langue === "en" ? STATUT_DOCUMENT_EN : STATUT_DOCUMENT)[s]?.libelle ?? s;
}

export function tonaliteStatutDocument(s: StatutDocumentIngestion): TonaliteStatut {
  return STATUT_DOCUMENT[s]?.tonalite ?? "neutre";
}

/** Résultat d'un document terminé ; « — » tant qu'il n'y en a pas. */
export function libelleResultat(
  r: ResultatIngestion | null | undefined,
  langue: Langue = "fr",
): string {
  return r ? ((langue === "en" ? LIBELLES_RESULTAT_EN : LIBELLES_RESULTAT)[r] ?? r) : "—";
}

/** Le texte des pages de ce document a été purgé (les références de page restent valables). */
export function textePurge(doc: { texte_purge_le?: string | null } | null | undefined): boolean {
  return Boolean(doc?.texte_purge_le);
}

export function libelleUsage(u: UsageIngestion, langue: Langue = "fr"): string {
  return (langue === "en" ? LIBELLES_USAGE_EN : LIBELLES_USAGE_INGESTION)[u] ?? u;
}

export function libelleMethode(
  m: MethodeExtraction | null | undefined,
  langue: Langue = "fr",
): string {
  return m ? ((langue === "en" ? LIBELLES_METHODE_EN : LIBELLES_METHODE)[m] ?? m) : "—";
}

export function libelleStatutExtraction(s: StatutExtraction, langue: Langue = "fr"): string {
  return (langue === "en" ? LIBELLES_STATUT_EXTRACTION_EN : LIBELLES_STATUT_EXTRACTION)[s] ?? s;
}

/** Message lisible d'un code d'erreur d'ingestion ; repli sur l'erreur interne pour un code inconnu. */
/** Méthode qui lit des images : la confiance de page existe et le résultat se vérifie à la main. */
export function methodeOcr(m: MethodeExtraction | null | undefined): boolean {
  return m === "ocr" || m === "ocr_simule";
}

/** Phrase d'aide ajoutée au message d'un code d'erreur d'OCR (null si le code n'en demande pas). */
export function aideErreurIngestion(
  code: string | null | undefined,
  langue: Langue = "fr",
): string | null {
  return code === "OCR_INDISPONIBLE"
    ? creerTraduire(langue)(
        "Contactez l'administrateur : le moteur de lecture des scans n'est pas activé sur ce serveur.",
        "Contact the administrator: the scan reading engine is not enabled on this server.",
      )
    : null;
}

/** Libellé d'une confusion de lecture : « lettre O lue pour le chiffre 0 ». */
export function libelleConfusionOcr(c: ConfusionOcr, langue: Langue = "fr"): string {
  return (langue === "en" ? LIBELLES_CONFUSION_OCR_EN : LIBELLES_CONFUSION_OCR)[c] ?? c;
}

/** Confusions en clair, séparées par un point-virgule ; « — » s'il n'y en a pas. */
export function decrireConfusionsOcr(
  confusions: readonly ConfusionOcr[] | null | undefined,
  langue: Langue = "fr",
): string {
  const l = (confusions ?? []).map((c) => libelleConfusionOcr(c, langue));
  return l.length === 0 ? "—" : l.join(langue === "en" ? "; " : " ; ");
}

export function libelleErreurIngestion(
  code: string | null | undefined,
  langue: Langue = "fr",
): string | null {
  if (!code) return null;
  const table = langue === "en" ? LIBELLES_ERREUR_INGESTION_EN : LIBELLES_ERREUR_INGESTION;
  return table[code as CodeErreurIngestion] ?? table.ERREUR_INTERNE;
}

/** Erreur d'un document : le message de l'API, sinon celui du code. */
export function erreurDocument(
  d: Pick<DocumentIngestion, "erreur" | "erreur_code">,
  langue: Langue = "fr",
): string | null {
  return d.erreur ?? libelleErreurIngestion(d.erreur_code, langue);
}

/** Message d'un document en échec suivi, le cas échéant, de la phrase d'aide de son code. */
export function erreurDocumentAvecAide(
  d: Pick<DocumentIngestion, "erreur" | "erreur_code">,
  langue: Langue = "fr",
): string | null {
  const m = erreurDocument(d, langue);
  const aide = aideErreurIngestion(d.erreur_code, langue);
  return m && aide ? `${m} ${aide}` : m;
}

/** Document encore traité en arrière-plan : la page doit se rafraîchir. */
export function documentEnCours(d: Pick<DocumentIngestion, "statut">): boolean {
  return STATUTS_EN_COURS.includes(d.statut);
}

export function auMoinsUnEnCours(docs: readonly Pick<DocumentIngestion, "statut">[]): boolean {
  return docs.some(documentEnCours);
}

/** Taille lisible : « 850 o », « 12,5 Ko », « 1,2 Mo ». */
export function formaterTaille(octets: number, langue: Langue = "fr"): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  const nf = (v: number) =>
    new Intl.NumberFormat(LOCALES_INTL[langue], { maximumFractionDigits: 1 }).format(v);
  const en = langue === "en";
  if (octets < 1024) return `${Math.round(octets)} ${en ? "B" : "o"}`;
  if (octets < 1024 * 1024) return `${nf(octets / 1024)} ${en ? "KB" : "Ko"}`;
  return `${nf(octets / (1024 * 1024))} ${en ? "MB" : "Mo"}`;
}

/** Confiance d'une page lue par reconnaissance de caractères (millièmes, « 87 % »), sinon « — ». */
export function formaterConfiancePage(pm: number | null | undefined): string {
  if (pm === null || pm === undefined || !Number.isFinite(pm)) return "—";
  return `${Math.round(Math.min(1000, Math.max(0, pm)) / 10)} %`;
}

/** Taille d'une page pour la liste : « 1 240 caractères ». */
export function formaterCaracteres(n: number, langue: Langue = "fr"): string {
  const nombre = new Intl.NumberFormat(LOCALES_INTL[langue]).format(n);
  return langue === "en"
    ? `${nombre} character${n > 1 ? "s" : ""}`
    : `${nombre} caractère${n > 1 ? "s" : ""}`;
}

/** Message d'erreur affichable d'un appel d'ingestion (langue du navigateur si non précisée). */
export function messageErreur(e: unknown, langue?: Langue): string {
  return messageErreurApi(e, langue);
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
  langue: Langue = "fr",
): ControleFichier {
  const t = creerTraduire(langue);
  if (!fichier)
    return {
      ok: false,
      message: t(
        "Choisissez un fichier PDF ou Excel (.xlsx).",
        "Choose a PDF or Excel (.xlsx) file.",
      ),
    };
  const format = formatDepuisNom(fichier.name);
  if (!format) {
    return {
      ok: false,
      message: t(
        "Format accepté : PDF (.pdf) ou classeur Excel (.xlsx).",
        "Accepted format: PDF (.pdf) or Excel workbook (.xlsx).",
      ),
    };
  }
  if (fichier.size <= 0)
    return { ok: false, message: t("Ce fichier est vide.", "This file is empty.") };
  if (fichier.size > plafondTaille(format)) {
    return {
      ok: false,
      message: t(
        `Fichier trop volumineux : ${mo(plafondTaille(format))} Mo au plus pour un ${
          format === "pdf" ? "PDF" : "classeur Excel"
        } (celui-ci fait ${formaterTaille(fichier.size)}).`,
        `File too large: ${mo(plafondTaille(format))} MB at most for ${
          format === "pdf" ? "a PDF" : "an Excel workbook"
        } (this one is ${formaterTaille(fichier.size, langue)}).`,
      ),
    };
  }
  return { ok: true, format };
}

/** Ce qui arrive à un PDF scanné : lu par OCR local, plafond de pages tiré de `PLAFONDS_OCR`. */
export const TEXTE_SCAN_OCR =
  "Un PDF scanné est lu par reconnaissance de caractères (OCR) sur le serveur, plus lent " +
  `(quelques secondes par page, ${PLAFONDS_OCR.pagesMax} pages au plus) ; ` +
  "l'état obtenu part toujours en revue et chaque chiffre est à vérifier dans le document.";

export const TEXTE_SCAN_OCR_EN =
  "A scanned PDF is read by character recognition (OCR) on the server, which is slower " +
  `(a few seconds per page, ${PLAFONDS_OCR.pagesMax} pages at most); ` +
  "the resulting statement always goes to review and every figure must be checked against the document.";

/** Rappel des limites, affiché près du champ fichier. */
export function aideLimitesIngestion(langue: Langue = "fr"): string {
  if (langue === "en") {
    return (
      `PDF with text (${mo(PLAFONDS_INGESTION.tailleOctetsPdf)} MB and ${PLAFONDS_INGESTION.pagesMax} pages at most) ` +
      `or Excel .xlsx workbook (${mo(PLAFONDS_INGESTION.tailleOctetsXlsx)} MB at most). ` +
      TEXTE_SCAN_OCR_EN
    );
  }
  return (
    `PDF avec texte (${mo(PLAFONDS_INGESTION.tailleOctetsPdf)} Mo et ${PLAFONDS_INGESTION.pagesMax} pages au plus) ` +
    `ou classeur Excel .xlsx (${mo(PLAFONDS_INGESTION.tailleOctetsXlsx)} Mo au plus). ` +
    TEXTE_SCAN_OCR
  );
}

export * from "./ingestion-api";
