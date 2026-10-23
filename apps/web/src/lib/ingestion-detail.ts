/**
 * Textes d'état du détail d'un document importé : message de la liste de pages selon le statut, et
 * pertinence de l'aide sur la lecture par OCR. Fonctions pures, testées dans `ingestion-detail.test.ts`.
 */
import type { MethodeExtraction, StatutDocumentIngestion } from "@missionpilot/shared";
import { aideLimitesIngestion, methodeOcr, TEXTE_SCAN_OCR } from "./ingestion";

/**
 * Message affiché quand le document n'a aucune page lue. « Lecture en cours » tant que le document
 * est traité, motif de l'échec s'il y en a un, message neutre pour un document terminé sans page.
 */
export function messageAucunePage(
  statut: StatutDocumentIngestion | null | undefined,
  motifEchec?: string | null,
): string {
  switch (statut) {
    case "en_file":
    case "extraction":
    case "structuration":
      return "Lecture en cours : les pages apparaîtront ici une fois lues.";
    case "echec": {
      const base = "Aucune page n'a pu être lue (document vide ou illisible).";
      const motif = motifEchec?.trim();
      return motif ? `${base} ${motif}` : base;
    }
    default:
      return "Ce document ne contient aucune page lue.";
  }
}

/** Usage d'un téléversement : seul l'import d'un état financier est concerné par l'aide OCR. */
export type UsageTeleversement = "etat_financier" | "autre";

/** Aide placée près du champ fichier : limites ; consigne OCR seulement pour un état financier. */
export function aideTeleversement(usage: UsageTeleversement): string {
  const complete = aideLimitesIngestion();
  return usage === "etat_financier" ? complete : complete.replace(TEXTE_SCAN_OCR, "").trim();
}

/**
 * L'avertissement « lu par OCR » du détail d'un document est pertinent seulement quand un OCR a
 * effectivement servi (méthode `ocr`/`ocr_simule`) et que le document n'est pas en échec.
 */
export function avertissementOcrPertinent(doc: {
  statut: StatutDocumentIngestion;
  methode?: MethodeExtraction | null;
}): boolean {
  return doc.statut !== "echec" && methodeOcr(doc.methode);
}
