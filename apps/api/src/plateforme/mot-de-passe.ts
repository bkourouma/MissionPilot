import { randomInt } from "node:crypto";

/** Alphabets sans caractères ambigus (pas de 0/O, 1/l/I). */
const MAJUSCULES = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUSCULES = "abcdefghijkmnopqrstuvwxyz";
const CHIFFRES = "23456789";
const SYMBOLES = "!#$%&*+-=?@^_";
export const ALPHABET_MOT_DE_PASSE = MAJUSCULES + MINUSCULES + CHIFFRES + SYMBOLES;
export const LONGUEUR_MOT_DE_PASSE_GENERE = 24;

const tirer = (alphabet: string): string => alphabet.charAt(randomInt(alphabet.length));

/** Mélange de Fisher-Yates avec un tirage cryptographique. */
function melanger(caracteres: string[]): string[] {
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j]!, caracteres[i]!];
  }
  return caracteres;
}

/**
 * Mot de passe aléatoire (générateur cryptographique de Node) : au moins une
 * majuscule, une minuscule, un chiffre et un symbole, jamais journalisé.
 */
export function genererMotDePasse(longueur = LONGUEUR_MOT_DE_PASSE_GENERE): string {
  if (longueur < 20) throw new Error("Longueur de mot de passe généré insuffisante.");
  const obligatoires = [MAJUSCULES, MINUSCULES, CHIFFRES, SYMBOLES].map(tirer);
  const reste = Array.from({ length: longueur - obligatoires.length }, () =>
    tirer(ALPHABET_MOT_DE_PASSE),
  );
  return melanger([...obligatoires, ...reste]).join("");
}
