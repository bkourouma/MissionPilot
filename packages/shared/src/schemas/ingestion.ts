import { z } from "zod";
import { texte, texteOptionnel } from "./commun";
import { etatFinancierExcelQuerySchema } from "./dossier";
import { codeReferentielSchema } from "./fondations";
import { TYPES_ELEMENT_METHODE } from "./standard";

/*
 * Ingestion de documents (lot 6, ADR-009) : DOS-03 (états financiers PDF / Excel), DD-02 et DD-10
 * (rapports et salle de données de la due diligence), STD-13 (amorçage du standard).
 *
 * Un document est ANALYSÉ, jamais conservé (le texte de ses pages l'est). Ce qu'en tire l'IA est un
 * BROUILLON avec la page et un extrait pour chaque élément ; un état financier passe par les
 * contrôles du moteur. Aucun nombre ne vient du modèle : un montant n'est retenu que retrouvé dans
 * la page citée.
 */

/** Plafonds provisoires (ADR-009, décision 5) : appliqués par l'API et affichés par le web. */
export const PLAFONDS_INGESTION = {
  tailleOctetsPdf: 10 * 1024 * 1024,
  tailleOctetsXlsx: 2 * 1024 * 1024,
  pagesMax: 60,
  caracteresParPage: 25_000,
  caracteresParDocument: 400_000,
  dureeExtractionMs: 30_000,
  documentsEnTraitementParCabinet: 5,
  documentsParJourEtCabinet: 40,
  caracteresTransmisAuModele: 40_000,
} as const;

export const USAGES_INGESTION = [
  "etat_financier",
  "dd_rapport",
  "dd_salle",
  "standard_historique",
] as const;
export type UsageIngestion = (typeof USAGES_INGESTION)[number];

export const FORMATS_INGESTION = ["pdf", "xlsx"] as const;
export type FormatIngestion = (typeof FORMATS_INGESTION)[number];

export const STATUTS_DOCUMENT_INGESTION = [
  "en_file",
  "extraction",
  "structuration",
  "termine",
  "echec",
] as const;
export type StatutDocumentIngestion = (typeof STATUTS_DOCUMENT_INGESTION)[number];

export const RESULTATS_INGESTION = [
  "etat_cree",
  "brouillon_cree",
  "ia_indisponible",
  "rien_trouve",
] as const;
export type ResultatIngestion = (typeof RESULTATS_INGESTION)[number];

export const METHODES_EXTRACTION = ["texte", "ocr_simule", "tableur"] as const;
export type MethodeExtraction = (typeof METHODES_EXTRACTION)[number];

/** Codes d'erreur stables d'un document en échec (jamais un contenu). */
export const CODES_ERREUR_INGESTION = [
  "PDF_ILLISIBLE",
  "PDF_SANS_TEXTE",
  "OCR_NON_SIMULE",
  "PLAFOND_PAGES",
  "PLAFOND_TEXTE",
  "DELAI_DEPASSE",
  "TABLEUR_ILLISIBLE",
  "FICHIER_ABSENT",
  "UTILISATEUR_INACTIF",
  "DOSSIER_INACCESSIBLE",
  "ETAT_INVALIDE",
  "ERREUR_INTERNE",
] as const;
export type CodeErreurIngestion = (typeof CODES_ERREUR_INGESTION)[number];

export const LIBELLES_ERREUR_INGESTION: Record<CodeErreurIngestion, string> = {
  PDF_ILLISIBLE: "Le PDF est illisible ou protégé.",
  PDF_SANS_TEXTE:
    "Document scanné : la reconnaissance de caractères n'est pas disponible. Fournissez un PDF avec texte.",
  OCR_NON_SIMULE: "La reconnaissance de caractères simulée ne lit que ses documents de test.",
  PLAFOND_PAGES: "Le document dépasse le nombre de pages autorisé.",
  PLAFOND_TEXTE: "Le texte du document dépasse la taille autorisée.",
  DELAI_DEPASSE: "La lecture du document a dépassé le délai autorisé.",
  TABLEUR_ILLISIBLE: "Le classeur est illisible.",
  FICHIER_ABSENT: "Le fichier téléversé n'est plus disponible : téléversez-le à nouveau.",
  UTILISATEUR_INACTIF: "L'auteur du téléversement n'est plus actif.",
  DOSSIER_INACCESSIBLE: "Le dossier n'est plus accessible à l'auteur du téléversement.",
  ETAT_INVALIDE: "Les lignes lues ne forment pas un état exploitable.",
  ERREUR_INTERNE: "Erreur interne : réessayez plus tard.",
};

export const LIBELLES_USAGE_INGESTION: Record<UsageIngestion, string> = {
  etat_financier: "État financier",
  dd_rapport: "Rapport (due diligence)",
  dd_salle: "Salle de données (due diligence)",
  standard_historique: "Document historique (amorçage du standard)",
};

/** Paramètres d'un état financier téléversé (multipart : passés dans la requête). */
export const ingestionEtatQuerySchema = etatFinancierExcelQuerySchema;
export type IngestionEtatQuery = z.infer<typeof ingestionEtatQuerySchema>;

export const TYPES_DOCUMENT_DD = ["rapport", "salle"] as const;
export const ingestionDdQuerySchema = z.object({ type: z.enum(TYPES_DOCUMENT_DD) }).strict();

export const ingestionListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/** Paramètre de route `numero` (page) ; strict, les autres paramètres de la route sont fusionnés par l'appelant. */
export const numeroPageParamsSchema = z
  .object({ numero: z.coerce.number().int().min(1).max(200) })
  .strict();

// ---------------------------------------------------------------------------
// Lecture d'un document (DD-02, DD-10)
// ---------------------------------------------------------------------------

export const TYPES_ELEMENT_LECTURE = ["fait", "risque", "chiffre", "engagement", "autre"] as const;
export type TypeElementLecture = (typeof TYPES_ELEMENT_LECTURE)[number];

export const LIBELLES_ELEMENT_LECTURE: Record<TypeElementLecture, string> = {
  fait: "Fait",
  risque: "Risque",
  chiffre: "Chiffre",
  engagement: "Engagement",
  autre: "Autre",
};

const pageSchema = z.number().int().min(1).max(200);

export const elementLectureSchema = z
  .object({
    page: pageSchema,
    type: z.enum(TYPES_ELEMENT_LECTURE),
    /** Extrait recopié de la page citée (le moteur vérifie qu'il s'y trouve). */
    extrait: texte(400),
    enonce: texte(500),
    /** Extrait et nombres retrouvés dans la page citée (calculé par le serveur, jamais saisi). */
    verifie: z.boolean(),
  })
  .strict();
export type ElementLecture = z.infer<typeof elementLectureSchema>;

export const LECTURE_ELEMENTS_MAX = 60;
export const LECTURE_RESUME_MAX = 10;

export const contenuLectureSchema = z
  .object({
    resume: z
      .array(z.object({ page: pageSchema, texte: texte(1000) }).strict())
      .max(LECTURE_RESUME_MAX),
    elements: z.array(elementLectureSchema).max(LECTURE_ELEMENTS_MAX),
    /** Le texte transmis au modèle a été limité : la fin du document n'a pas été lue. */
    tronque: z.boolean(),
  })
  .strict();
export type ContenuLecture = z.infer<typeof contenuLectureSchema>;

// ---------------------------------------------------------------------------
// Proposition de standard (STD-13)
// ---------------------------------------------------------------------------

const libelleCourt = texte(200);

export const propositionEtapeSchema = z
  .object({ code: codeReferentielSchema, libelle: libelleCourt, page: pageSchema })
  .strict();

export const propositionBriqueSchema = z
  .object({
    etape_code: codeReferentielSchema,
    code: codeReferentielSchema,
    libelle: libelleCourt,
    objet: texte(2000),
    page: pageSchema,
  })
  .strict();

export const propositionElementSchema = z
  .object({
    type: z.enum(TYPES_ELEMENT_METHODE),
    code: codeReferentielSchema,
    libelle: libelleCourt,
    description: texteOptionnel(2000),
    brique_code: codeReferentielSchema.nullable().optional(),
    page: pageSchema,
  })
  .strict();

export const propositionRubriqueSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: libelleCourt,
    /** Cinq niveaux, du plus faible au plus fort, décrits par des comportements observables. */
    niveaux: z.array(texte(1000)).length(5),
    page: pageSchema,
  })
  .strict();

export const PROPOSITION_MAXIMA = {
  etapes: 20,
  briques: 60,
  elements: 100,
  rubriques: 30,
} as const;

export const contenuPropositionSchema = z
  .object({
    etapes: z.array(propositionEtapeSchema).max(PROPOSITION_MAXIMA.etapes),
    briques: z.array(propositionBriqueSchema).max(PROPOSITION_MAXIMA.briques),
    elements: z.array(propositionElementSchema).max(PROPOSITION_MAXIMA.elements),
    rubriques: z.array(propositionRubriqueSchema).max(PROPOSITION_MAXIMA.rubriques),
    tronque: z.boolean(),
  })
  .strict();
export type ContenuProposition = z.infer<typeof contenuPropositionSchema>;

// ---------------------------------------------------------------------------
// Correction et décision d'une extraction (brouillon)
// ---------------------------------------------------------------------------

export const NATURES_EXTRACTION = ["lecture_document", "standard_proposition"] as const;
export type NatureExtraction = (typeof NATURES_EXTRACTION)[number];

export const STATUTS_EXTRACTION = ["brouillon_ia", "modifie", "valide", "rejete"] as const;
export type StatutExtraction = (typeof STATUTS_EXTRACTION)[number];

export const LIBELLES_STATUT_EXTRACTION: Record<StatutExtraction, string> = {
  brouillon_ia: "Brouillon IA",
  modifie: "Modifié",
  valide: "Validé",
  rejete: "Rejeté",
};

/** Correction humaine : le contenu complet remplace le précédent (relu par le serveur selon la nature). */
export const extractionModificationSchema = z
  .object({ contenu: z.record(z.string(), z.unknown()) })
  .strict();

export const extractionDecisionSchema = z
  .object({
    decision: z.enum(["validee", "rejetee"]),
    motif: texteOptionnel(1000),
    /** Obligatoire pour valider un brouillon qui contient des éléments non vérifiés dans la source. */
    acquitte_chiffres: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.decision !== "rejetee" || Boolean(d.motif), {
    message: "Motif obligatoire pour rejeter une extraction.",
    path: ["motif"],
  });
export type ExtractionDecision = z.infer<typeof extractionDecisionSchema>;
