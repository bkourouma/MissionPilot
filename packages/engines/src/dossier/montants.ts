/**
 * Lecture EXACTE d'un montant saisi en texte (cellule de classeur, CSV) vers
 * des unités mineures entières, sans jamais passer par un nombre à virgule
 * flottante : « 1 234 567 » → 1234567 (FCFA) ; « -1 234,50 » → -123450
 * (EUR, 2 décimales) ; « (12 000) » → -12000 (présentation comptable).
 *
 * Règles (refus plutôt qu'arrondi silencieux) :
 * - espaces, espaces insécables et apostrophes servent de séparateurs de
 *   milliers et sont retirés ;
 * - signe « - » ou « − » en tête, ou montant entre parenthèses : négatif ;
 * - UN séparateur décimal au plus, « , » ou « . », suivi d'au plus
 *   `decimales` chiffres significatifs (des zéros au-delà sont admis :
 *   « 1234,00 » en FCFA vaut 1234) ;
 * - notation scientifique, plusieurs séparateurs, texte : refusés ;
 * - valeur absolue au plus `MONTANT_TEXTE_MAX` unités mineures.
 */
import { ErreurDossier } from "./erreurs";

/** Plafond d'un montant lu (unités mineures) : 10^15, sommes exactes garanties en aval. */
export const MONTANT_TEXTE_MAX = 1_000_000_000_000_000;

const SEPARATEURS_MILLIERS = /[\s\u00a0\u202f']/g;
const FORME = /^(\d+)(?:[.,](\d+))?$/;

function refus(texte: string): ErreurDossier {
  return new ErreurDossier("MONTANT_INVALIDE", `Montant illisible : « ${texte.slice(0, 40)} ».`);
}

/** Montant en unités mineures lu dans `texte`, avec `decimales` décimales (0 à 4). */
export function lireMontantTexte(texte: string, decimales: number): number {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 4) {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Nombre de décimales entre 0 et 4 attendu.");
  }
  let t = texte.replace(SEPARATEURS_MILLIERS, "");
  let negatif = false;
  if (t.startsWith("(") && t.endsWith(")")) {
    negatif = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("-") || t.startsWith("\u2212")) {
    if (negatif) throw refus(texte);
    negatif = true;
    t = t.slice(1);
  }
  const m = FORME.exec(t);
  if (!m || t.length > 40) throw refus(texte);
  const entiers = m[1] as string;
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  if (fraction.length > decimales) {
    throw new ErreurDossier(
      "MONTANT_INVALIDE",
      `Montant trop précis : ${decimales} décimale(s) au plus (« ${texte.slice(0, 40)} »).`,
    );
  }
  const valeur = BigInt(entiers + fraction.padEnd(decimales, "0"));
  if (valeur > BigInt(MONTANT_TEXTE_MAX)) {
    throw new ErreurDossier("MONTANT_INVALIDE", "Montant hors limites.");
  }
  const n = Number(valeur);
  return negatif && n !== 0 ? -n : n;
}
