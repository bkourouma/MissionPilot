import type { MethodeExtraction } from "@missionpilot/shared";

/** Une page (ou une feuille de tableur) dont le texte a été extrait. */
export interface PageExtraite {
  /** Numéro à partir de 1. */
  numero: number;
  texte: string;
  methode: MethodeExtraction;
  /** Confiance de 0 à 1000, seulement pour une page reconnue par OCR (sinon null). */
  confiance_pm: number | null;
}

export interface ResultatExtractionTexte {
  /** Méthode du document : `texte` (couche texte), `ocr_simule` ou `tableur`. */
  methode: MethodeExtraction;
  pages: PageExtraite[];
}

/** Types des jobs de la file `jobs` (ADR-009 : extraction du texte, puis structuration selon l'usage). */
export const TYPE_JOB_INGESTION_EXTRACTION = "ingestion_extraction";
export const TYPE_JOB_INGESTION_STRUCTURATION = "ingestion_structuration";
/** Tentatives de chacun des deux jobs. */
export const TENTATIVES_INGESTION = 3;
