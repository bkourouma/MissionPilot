/**
 * Numéros de téléphone (lot 3c, SPEC §9.1). Fonctions pures : aucun pays par défaut (O-02), le
 * numéro doit être au format international. Aucune fonction ne cite le numéro dans une erreur.
 */
import { ErreurCanaux } from "./erreurs";

const E164 = /^\+[1-9]\d{7,14}$/;
/** Numéros de test réservés au fournisseur simulé : `+225`, huit zéros, deux chiffres. */
const NUMERO_DE_TEST = /^\+22500000000\d{2}$/;

/**
 * Normalise une saisie en E.164 : retire espaces, points, tirets et parenthèses ; un `00` initial
 * devient `+` ; exige `^\+[1-9]\d{7,14}$`. Un numéro national sans `+` ni `00` est refusé.
 */
export function normaliserNumero(texte: string): string {
  if (typeof texte !== "string" || texte.length > 60) throw new ErreurCanaux("NUMERO_INVALIDE");
  let numero = texte.replace(/[\s.\-()]/g, "");
  if (numero.startsWith("00")) numero = `+${numero.slice(2)}`;
  if (!E164.test(numero)) throw new ErreurCanaux("NUMERO_INVALIDE");
  return numero;
}

/** Masque d'affichage : quatre premiers caractères, `…`, deux derniers (`+225…12`). */
export function masquerNumero(e164: string): string {
  if (!E164.test(e164)) throw new ErreurCanaux("NUMERO_INVALIDE");
  return `${e164.slice(0, 4)}…${e164.slice(-2)}`;
}

/** Vrai pour un numéro de la plage de test réservée aux fournisseurs simulés. */
export function estNumeroDeTest(e164: string): boolean {
  return NUMERO_DE_TEST.test(e164);
}
