import type { Ocr } from "../src/ingestion/ocr.js";
import { diagnosticOcrLocal, ocrLocalDisponible } from "../src/ingestion/ocr-local.js";
import type { ContexteIngestion } from "./ingestion-outils.js";
import { fabriquerPdfScanDepuisFixtures, lireManifesteOcr } from "./ocr-outils.js";

/*
 * Utilitaires des tests de la CHAÎNE OCR réelle (lot 11) : disponibilité du moteur, scans fabriqués depuis
 * les fixtures, montants de la vérité terrain, substitution de l'OCR du harnais d'ingestion.
 */

export const OCR_LOCAL_DISPONIBLE = ocrLocalDisponible();
export const RAISON_OCR_INDISPONIBLE = diagnosticOcrLocal();
/** Délai (ms) des tests qui lancent le moteur réel sur une base partagée avec d'autres processus. */
export const DELAI_TEST_OCR = 180_000;

const manifeste = lireManifesteOcr();

export function fixtureOcr(nom: string) {
  const f = manifeste.fichiers.find((x) => x.nom === nom);
  if (!f) throw new Error(`fixture absente : ${nom}`);
  return f;
}

/** PDF scanné (une page par nom de fixture), à la résolution de la première image. */
export const pdfScan = (...noms: string[]) =>
  fabriquerPdfScanDepuisFixtures(noms, fixtureOcr(noms[0] as string).dpi);

/** Montants (entiers) de la vérité terrain d'une fixture. */
export const montantsVerite = (nom: string): number[] =>
  fixtureOcr(nom).lignes.map((l) => l.montant);

/** Exécute `travail` avec `ocr` à la place de l'OCR du harnais, puis le remet. */
export async function avecOcr<T>(
  ctx: ContexteIngestion,
  ocr: Ocr | null,
  travail: () => Promise<T>,
): Promise<T> {
  const avant = ctx.deps.ocr;
  ctx.deps.ocr = ocr;
  try {
    return await travail();
  } finally {
    ctx.deps.ocr = avant;
  }
}

/** Fragments de la vérité terrain d'une fixture (libellés, en-tête, montants sous plusieurs écritures). */
export function fragmentsConnus(nom: string): string[] {
  const f = fixtureOcr(nom);
  const montants = f.lignes.flatMap((l) => [
    String(l.montant),
    l.montant.toLocaleString("en-US"),
    String(l.montant).replace(/\B(?=(\d{3})+(?!\d))/g, " "),
  ]);
  return [...f.lignes.map((l) => l.libelle), f.entete, ...montants];
}
