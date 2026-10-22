import type { NatureExtraction } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { DocumentIngestion } from "./documents.js";
import type { ExtractionLigne } from "./extractions.js";
import { natureLecture } from "./nature-lecture.js";
import { natureProposition } from "./nature-proposition.js";

/*
 * Registre des natures d'extraction (brouillons produits par l'IA à partir du texte d'un document).
 * Chaque nature sait relire un contenu (jamais pris tel quel), dire s'il contient des éléments non
 * vérifiés dans la source et, éventuellement, s'appliquer à la validation.
 */

export interface NatureExtractionApi {
  readonly nature: NatureExtraction;
  /**
   * Contenu relu et borné ; lève `AppError` 400 s'il est invalide. `pages` est le texte des pages du document
   * (pour recalculer côté serveur les drapeaux de vérification : ils ne sont jamais crus d'un client).
   */
  validerContenu(
    contenu: unknown,
    pages: readonly { numero: number; texte: string }[],
  ): Record<string, unknown>;
  /** Le contenu cite des extraits ou des nombres introuvables dans la page citée. */
  contientNonVerifie(contenu: Record<string, unknown>): boolean;
  /**
   * Appelée par `deciderExtraction` à la VALIDATION, dans la même transaction, avant l'inscription de la
   * décision ; son résultat (objet borné, sans contenu du document) est enregistré dans `resultat`.
   */
  appliquer?(
    db: Db,
    auth: Auth,
    extraction: ExtractionLigne,
    document: DocumentIngestion,
  ): Promise<Record<string, unknown>>;
}

export const NATURES: Record<NatureExtraction, NatureExtractionApi> = {
  lecture_document: natureLecture,
  standard_proposition: natureProposition,
};

export function natureDe(nature: NatureExtraction): NatureExtractionApi {
  return NATURES[nature];
}
