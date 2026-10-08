/**
 * Socle du moteur des appels d'offres (AO-01 à AO-03, AO-08, PRD complémentaire §9) :
 * erreur typée, normalisation des termes et arithmétique entière des notes.
 *
 * Fonctions pures et déterministes : aucune horloge (la date du jour est un paramètre), aucun
 * appel externe, aucun flottant dans les notes (entiers de 0 à 100).
 */

export type CodeErreurAppelsOffres = "ENTREE_INVALIDE" | "DATE_INVALIDE" | "DATE_LIMITE_PASSEE";

export class ErreurAppelsOffres extends Error {
  readonly code: CodeErreurAppelsOffres;

  constructor(code: CodeErreurAppelsOffres, message: string) {
    super(message);
    this.name = "ErreurAppelsOffres";
    this.code = code;
  }
}

/** Mots vides ignorés dans les rapprochements (français et anglais courants). */
const MOTS_VIDES = new Set([
  "les",
  "des",
  "une",
  "pour",
  "dans",
  "avec",
  "sur",
  "par",
  "aux",
  "est",
  "son",
  "ses",
  "leur",
  "leurs",
  "qui",
  "que",
  "and",
  "the",
  "for",
  "with",
  "from",
  "mission",
  "missions",
  "projet",
  "prestation",
  "prestations",
  "services",
  "service",
  "secteur",
  "secteurs",
  "appui",
  "etude",
  "etudes",
]);

/** Minuscules sans accents, ponctuation ramenée à des espaces simples. */
export function normaliserTerme(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mots significatifs d'un texte (3 caractères au moins, hors mots vides), sans doublon. */
export function motsSignificatifs(texte: string): string[] {
  const mots = normaliserTerme(texte)
    .split(" ")
    .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m));
  return [...new Set(mots)];
}

/** Deux libellés désignent-ils le même domaine (égalité normalisée ou un mot significatif commun) ? */
export function libellesProches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const na = normaliserTerme(a);
  const nb = normaliserTerme(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  const mb = new Set(motsSignificatifs(b));
  return motsSignificatifs(a).some((m) => mb.has(m));
}

/** Entier naturel (0 compris) ? */
export function estEntierNaturel(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** Note entière bornée à [0, 100]. */
export function borner100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** `numerateur / denominateur` arrondi à l'entier, moitié vers le haut (entiers positifs). */
export function diviserArrondi(numerateur: number, denominateur: number): number {
  return Math.floor((2 * numerateur + denominateur) / (2 * denominateur));
}

/** Part entière (plancher) en pour-cent, bornée à 100 ; 0 si le dénominateur est nul. */
export function pourCentPlancher(numerateur: number, denominateur: number): number {
  if (denominateur <= 0) return 0;
  return borner100(Math.floor((numerateur * 100) / denominateur));
}
