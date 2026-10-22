import { normaliserTextePage, verifierPlafondsDocument } from "@missionpilot/engines";
import { PLAFONDS_INGESTION } from "@missionpilot/shared";
import { AppError } from "../errors.js";
import { lireClasseurTemps } from "../temps/import-excel.js";
import { ErreurIngestion } from "./erreurs.js";
import type { ResultatExtractionTexte } from "./types.js";

/*
 * Texte d'un classeur .xlsx (ADR-009, décision 3). Le lecteur borné `lireClasseurTemps` contrôle
 * l'archive (taille, macros, liaisons externes, formules jamais évaluées) et ne lit que la première
 * feuille visible. Cette feuille est la « page 1 » du document.
 *
 * FORMAT DU TEXTE DE LA PAGE, une ligne par ligne non vide de la feuille :
 *     L<numéro de ligne> | <cellule A> | <cellule B> | …
 * Les cellules gardent leur POSITION (une cellule vide donne un champ vide), les « | » et sauts de ligne
 * d'une cellule sont remplacés ; `lignesDeTexteTableur` relit ce format (le texte de la page est la seule
 * source de la structuration, le classeur n'est plus conservé).
 *
 * Limite : le lecteur borné ne donne pas le numéro de la ligne d'en-tête (première ligne non vide) ;
 * elle est supposée être la ligne 1.
 */

const PREFIXE_LIGNE = /^L([1-9][0-9]{0,6}) \|(.*)$/;

const nettoyerCellule = (c: string) =>
  c
    .replace(/[|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Lignes (numéro, cellules) relues dans le texte de la page d'un tableur. */
export function lignesDeTexteTableur(texte: string): { numero: number; valeurs: string[] }[] {
  const lignes: { numero: number; valeurs: string[] }[] = [];
  for (const l of texte.split("\n")) {
    const m = PREFIXE_LIGNE.exec(l);
    if (!m) continue;
    lignes.push({
      numero: Number(m[1]),
      valeurs: (m[2] as string).split("|").map((v) => v.trim()),
    });
  }
  return lignes;
}

/** Page unique d'un classeur .xlsx. Lève `ErreurIngestion` (TABLEUR_ILLISIBLE, PLAFOND_*). */
export async function extrairePagesTableur(contenu: Buffer): Promise<ResultatExtractionTexte> {
  let tableau;
  try {
    tableau = await lireClasseurTemps(contenu);
  } catch (error) {
    // Classeur refusé par le lecteur borné (400/413) : échec définitif ; saturation (503) : reprise.
    if (error instanceof AppError && error.statut !== 503) {
      throw new ErreurIngestion("TABLEUR_ILLISIBLE");
    }
    throw error;
  }
  const brutes = [{ numero: 1, valeurs: tableau.entete }, ...tableau.lignes];
  const lignes: string[] = [];
  for (const l of brutes) {
    const cellules = l.valeurs.map(nettoyerCellule);
    while (cellules.length > 0 && cellules[cellules.length - 1] === "") cellules.pop();
    if (cellules.length === 0) continue;
    lignes.push(`L${l.numero} | ${cellules.join(" | ")}`);
  }
  const texte = normaliserTextePage(lignes.join("\n"));
  const pages = [{ numero: 1, texte }];
  const depasse = verifierPlafondsDocument(pages, {
    pagesMax: PLAFONDS_INGESTION.pagesMax,
    caracteresParPage: PLAFONDS_INGESTION.caracteresParPage,
    caracteresParDocument: PLAFONDS_INGESTION.caracteresParDocument,
  });
  if (depasse) throw new ErreurIngestion(depasse);
  return {
    methode: "tableur",
    pages: [{ numero: 1, texte, methode: "tableur", confiance_pm: null }],
  };
}
