/**
 * Analyse d'une réponse entrante (lot 3c, SPEC §9.1). Du code déterministe, jamais un modèle de
 * langage : le texte reçu est une donnée non fiable (AGT-07) et seules des commandes fermées
 * (STOP, OUI, NON) sont reconnues. `stop` l'emporte toujours.
 */

export type TypeReponse = "stop" | "oui" | "non" | "autre";

export interface ReponseAnalysee {
  readonly type: TypeReponse;
  /** `oui` seulement : le reste du message normalisé (ex. `125000` pour `OUI 125000`). */
  readonly valeur?: string;
}

/** Longueur maximale d'un message analysé ; au-delà, `autre`. */
export const REPONSE_LONGUEUR_MAX = 1000;
/** Nombre de mots d'un message de désinscription dont le premier mot est une commande STOP. */
const STOP_MOTS_MAX = 3;
/** Nombre de mots d'un message `oui`/`non` (premier mot et valeur facultative). */
const COMMANDE_MOTS_MAX = 6;

const MOTS_STOP: ReadonlySet<string> = new Set([
  "stop",
  "arret",
  "arreter",
  "desabonner",
  "desinscrire",
  "desinscription",
  "desinscris",
  "arrete",
  "arretez",
  "stoppez",
  "stoper",
  "unsubscribe",
]);
const MOTS_OUI: ReadonlySet<string> = new Set(["oui", "ok", "d'accord", "confirme"]);
const MOTS_NON: ReadonlySet<string> = new Set(["non", "annuler"]);

/** NFKC, minuscules, accents ôtés, apostrophes typographiques ramenées à `'`. */
export function normaliserTexteCanal(texte: string): string {
  return texte
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .normalize("NFC");
}

/** Retire la ponctuation de bord d'un mot (lettres, chiffres, signe et pourcentage conservés). */
function mot(brut: string): string {
  return brut.replace(/^[^\p{L}\p{N}+-]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
}

export function analyserReponse(texte: string): ReponseAnalysee {
  if (typeof texte !== "string" || texte.length > REPONSE_LONGUEUR_MAX) return { type: "autre" };
  const mots = normaliserTexteCanal(texte)
    .split(/\s+/)
    .map(mot)
    .filter((m) => m !== "");
  const premier = mots[0];
  if (premier === undefined) return { type: "autre" };
  if (MOTS_STOP.has(premier) && mots.length <= STOP_MOTS_MAX) return { type: "stop" };
  if (mots.length > COMMANDE_MOTS_MAX) return { type: "autre" };
  if (MOTS_OUI.has(premier)) {
    const valeur = mots.slice(1).join(" ");
    return valeur === "" ? { type: "oui" } : { type: "oui", valeur };
  }
  if (MOTS_NON.has(premier) && mots.length <= STOP_MOTS_MAX) return { type: "non" };
  return { type: "autre" };
}
