/**
 * Normalisation du texte d'un message pour le routage déterministe du copilote (AGT-08).
 *
 * Deux formes :
 * - le texte « plié » (`plierTexteCopilote`) : minuscules et accents retirés, MÊME LONGUEUR que
 *   l'original (chaque unité de code est remplacée par une seule unité) ; une position trouvée
 *   dans le texte plié désigne donc la même position dans l'original, dont on reprend ainsi la
 *   casse et les accents (titre d'une tâche, nom d'une mission) ;
 * - le texte « normalisé » (`normaliserTexteCopilote`) : plié, ponctuation remplacée par des
 *   espaces, espaces fusionnés ; sert à la correspondance de mots-clés.
 * Le texte de l'utilisateur est une DONNÉE : il n'est jamais interprété comme une consigne.
 */

const APOSTROPHES = new Set(["’", "‘", "`", "´", "ʼ"]);
const GUILLEMETS = new Set(["«", "»", "“", "”", "„"]);
const ESPACES = new Set([" ", " ", " ", "​", "\t", "\n", "\r"]);

export function plierTexteCopilote(texte: string): string {
  let sortie = "";
  for (const c of texte) {
    if (c.length !== 1) {
      sortie += c;
    } else if (APOSTROPHES.has(c)) {
      sortie += "'";
    } else if (GUILLEMETS.has(c)) {
      sortie += '"';
    } else if (ESPACES.has(c)) {
      sortie += " ";
    } else {
      const bas = c.normalize("NFD").charAt(0).toLowerCase();
      sortie += bas.length === 1 ? bas : c;
    }
  }
  return sortie;
}

/** Mots-clés : plié, tout ce qui n'est pas lettre ou chiffre devient un espace. */
export function normaliserTexteCopilote(texte: string): string {
  return plierTexteCopilote(texte)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Texte de l'utilisateur sans espaces de tête ni de fin, ni caractère de contrôle. */
export function nettoyerMessageCopilote(texte: string): string {
  // eslint-disable-next-line no-control-regex
  return texte.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
}
