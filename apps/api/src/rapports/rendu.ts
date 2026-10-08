import { AppError } from "../errors.js";
import { rapportEnDocx } from "./docx.js";
import { normaliserRapport, type Rapport } from "./modele.js";
import { rapportEnPdf } from "./pdf.js";
import { rapportEnPptx } from "./pptx.js";

/*
 * Moteur de rapports (SOC-07) : un modèle de contenu (modele.ts), trois
 * rendus. Le rapport est validé et nettoyé AVANT tout rendu ; la sortie est
 * bornée (PLAFOND_RAPPORT_OCTETS et plafond des fichiers du cabinet).
 */

export const FORMATS_RAPPORT = ["pdf", "docx", "pptx"] as const;
export type FormatRapport = (typeof FORMATS_RAPPORT)[number];

/** Taille maximale d'un rapport rendu. */
export const PLAFOND_RAPPORT_OCTETS = 20 * 1024 * 1024;

export const TYPES_RAPPORT: Record<FormatRapport, { mime: string; extension: string }> = {
  pdf: { mime: "application/pdf", extension: "pdf" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
};

export interface OptionsRendu {
  /** Chemin du navigateur (PDF) ; null : rendu PDF indisponible (503). */
  cheminNavigateur: string | null;
  /** Cabinet demandeur : un seul rendu PDF simultané par cabinet (pdf.ts) ; null hors requête. */
  cabinetId: string | null;
  /** Plafond de sortie (par défaut PLAFOND_RAPPORT_OCTETS). */
  plafondOctets?: number;
  delaiPdfMs?: number;
}

/** Rapport (non fiable : validé ici) → contenu binaire du format demandé. */
export async function rendreRapport(
  brut: unknown,
  format: FormatRapport,
  options: OptionsRendu,
): Promise<{ rapport: Rapport; contenu: Buffer }> {
  const rapport = normaliserRapport(brut);
  let contenu: Buffer;
  if (format === "pdf") {
    if (!options.cheminNavigateur) {
      throw new AppError(
        503,
        "RENDU_PDF_INDISPONIBLE",
        "Le rendu PDF est indisponible : aucun navigateur configuré (CHROMIUM_PATH).",
      );
    }
    contenu = await rapportEnPdf(rapport, {
      cheminNavigateur: options.cheminNavigateur,
      cabinetId: options.cabinetId,
      delaiMs: options.delaiPdfMs,
    });
  } else {
    contenu = format === "docx" ? await rapportEnDocx(rapport) : await rapportEnPptx(rapport);
  }
  const plafond = Math.min(options.plafondOctets ?? PLAFOND_RAPPORT_OCTETS, PLAFOND_RAPPORT_OCTETS);
  if (contenu.length > plafond) {
    throw new AppError(413, "RAPPORT_TROP_VOLUMINEUX", "Le rapport dépasse la taille autorisée.");
  }
  return { rapport, contenu };
}
