import { type CodeErreurIngestion } from "@missionpilot/shared";
import { AppError } from "../errors.js";

/*
 * Erreurs de l'ingestion de documents (lot 6, ADR-009).
 *
 * - `AppError` pour ce qui répond à une requête HTTP (plafonds du cabinet, type refusé) ;
 * - `ErreurIngestion` pour ce qui met un DOCUMENT en échec dans un job : son code appartient à
 *   `CODES_ERREUR_INGESTION` (packages/shared) et ne porte jamais un message de bibliothèque ni un
 *   contenu du document.
 */

/** Plafonds par cabinet atteints (documents en traitement, créations du jour). */
export const ingestionPlein = (message: string) => new AppError(409, "INGESTION_PLEIN", message);

/** Seuls les PDF et les classeurs .xlsx se lisent ici. */
export const typeDocumentRefuse = () =>
  new AppError(
    415,
    "TYPE_DOCUMENT_REFUSE",
    "Seuls les documents PDF et les classeurs Excel (.xlsx) sont acceptés.",
  );

/** Fichier au-delà du plafond de taille (413) ; message unique pour toutes les routes d'ingestion. */
export const fichierTropVolumineux = (maxOctets: number) =>
  new AppError(
    413,
    "FICHIER_TROP_VOLUMINEUX",
    `Fichier trop volumineux : ${Math.floor(maxOctets / (1024 * 1024))} Mo au plus.`,
  );

/** Texte des pages purgé (conservation limitée) : la page n'est plus lisible, ses références restent. */
export const textePurge = () =>
  new AppError(
    404,
    "TEXTE_PURGE",
    "Texte purgé : le texte de ce document n'est plus conservé (les références de page restent).",
  );

/** Échec définitif d'un document (pas de reprise) : code stable, message neutre. */
export class ErreurIngestion extends Error {
  constructor(readonly code: CodeErreurIngestion) {
    super(code);
  }
}

/**
 * Convertit une exception quelconque en `ErreurIngestion` : une `ErreurIngestion` est conservée telle quelle,
 * toute autre (bibliothèque, adaptateur) devient `repli`. Ni le message ni la pile ne sortent : seul un
 * code stable est retenu.
 */
export function enErreurIngestion(erreur: unknown, repli: CodeErreurIngestion): ErreurIngestion {
  return erreur instanceof ErreurIngestion ? erreur : new ErreurIngestion(repli);
}
