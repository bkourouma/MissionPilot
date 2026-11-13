/**
 * Textes d'état du détail d'un document importé : message de la liste de pages selon le statut, et
 * pertinence de l'aide sur la lecture par OCR. Fonctions pures, testées dans `ingestion-detail.test.ts`.
 */
import {
  creerTraduire,
  type Langue,
  type MethodeExtraction,
  type StatutDocumentIngestion,
} from "@missionpilot/shared";
import { aideLimitesIngestion, methodeOcr, TEXTE_SCAN_OCR, TEXTE_SCAN_OCR_EN } from "./ingestion";

/**
 * Message affiché quand le document n'a aucune page lue. « Lecture en cours » tant que le document
 * est traité, motif de l'échec s'il y en a un, message neutre pour un document terminé sans page.
 */
export function messageAucunePage(
  statut: StatutDocumentIngestion | null | undefined,
  motifEchec?: string | null,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  switch (statut) {
    case "en_file":
    case "extraction":
    case "structuration":
      return t(
        "Lecture en cours : les pages apparaîtront ici une fois lues.",
        "Reading in progress: pages will appear here once read.",
      );
    case "echec": {
      const base = t(
        "Aucune page n'a pu être lue (document vide ou illisible).",
        "No page could be read (empty or unreadable document).",
      );
      const motif = motifEchec?.trim();
      return motif ? `${base} ${motif}` : base;
    }
    default:
      return t("Ce document ne contient aucune page lue.", "This document has no pages read.");
  }
}

/** Usage d'un téléversement : seul l'import d'un état financier est concerné par l'aide OCR. */
export type UsageTeleversement = "etat_financier" | "autre";

/** Aide placée près du champ fichier : limites ; consigne OCR seulement pour un état financier. */
export function aideTeleversement(usage: UsageTeleversement, langue: Langue = "fr"): string {
  const complete = aideLimitesIngestion(langue);
  return usage === "etat_financier"
    ? complete
    : complete.replace(langue === "en" ? TEXTE_SCAN_OCR_EN : TEXTE_SCAN_OCR, "").trim();
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
