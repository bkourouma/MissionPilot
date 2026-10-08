/**
 * Unités de temps (SOC-04, TPS-01). Le jour-homme est l'unité de stockage et
 * de calcul. En interne, les calculs se font en entiers (centièmes de jour,
 * minutes) pour éviter les erreurs de virgule flottante.
 */

/** Granularité de saisie paramétrée par le cabinet (docs/DECISIONS.md). */
export type Granularite = "demi_journee" | "heure";

/** Précision de stockage : un jour-homme = 100 centièmes. */
export const CENTIEMES_PAR_JOUR = 100;

/** Pas de saisie en demi-journée, en centièmes de jour. */
const PAS_DEMI_JOURNEE = 50;

/** Durée d'une journée par défaut (heures), éditable par le cabinet. */
export const HEURES_PAR_JOUR_DEFAUT = 8;

/** Arrondi entier symétrique, insensible au bruit flottant (ex. 1,005 × 100). */
export function arrondiEntier(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`Valeur non finie : ${x}`);
  const signe = x < 0 ? -1 : 1;
  const r = Math.round(Number(Math.abs(x).toFixed(8)));
  return r === 0 ? 0 : signe * r;
}

/** Jours décimaux → centièmes de jour (entier). */
export function versCentiemes(jours: number): number {
  return arrondiEntier(jours * CENTIEMES_PAR_JOUR);
}

/** Centièmes de jour → jours décimaux. */
export function depuisCentiemes(centiemes: number): number {
  return centiemes / CENTIEMES_PAR_JOUR;
}

/** Arrondit une valeur en jours au centième. */
export function arrondirJours(jours: number): number {
  return depuisCentiemes(versCentiemes(jours));
}

/** Somme exacte (au centième) d'une liste de jours. */
export function sommerJours(valeurs: readonly number[]): number {
  return depuisCentiemes(valeurs.reduce((total, v) => total + versCentiemes(v), 0));
}

/** Lève une `RangeError` si la durée d'une journée n'est pas dans ]0 ; 24]. */
export function verifierHeuresParJour(heuresParJour: number): void {
  if (!Number.isFinite(heuresParJour) || heuresParJour <= 0 || heuresParJour > 24) {
    throw new RangeError(`Durée de journée invalide : ${heuresParJour} h (attendu ]0 ; 24])`);
  }
}

/** Heures → jours-homme, arrondis à la minute puis au centième de jour. */
export function heuresVersJours(heures: number, heuresParJour = HEURES_PAR_JOUR_DEFAUT): number {
  verifierHeuresParJour(heuresParJour);
  const minutes = arrondiEntier(heures * 60);
  const minutesParJour = heuresParJour * 60;
  return depuisCentiemes(arrondiEntier((minutes * CENTIEMES_PAR_JOUR) / minutesParJour));
}

/**
 * Somme de saisies en heures convertie une seule fois en jours : à préférer à
 * la somme de conversions unitaires, qui cumulerait les arrondis au centième
 * (avec 8 h/jour, un centième de jour vaut 4,8 minutes).
 */
export function sommerHeuresEnJours(
  heures: readonly number[],
  heuresParJour = HEURES_PAR_JOUR_DEFAUT,
): number {
  const minutes = heures.reduce((total, h) => total + arrondiEntier(h * 60), 0);
  return heuresVersJours(minutes / 60, heuresParJour);
}

/** Jours-homme → minutes entières. */
export function joursVersMinutes(jours: number, heuresParJour = HEURES_PAR_JOUR_DEFAUT): number {
  verifierHeuresParJour(heuresParJour);
  return arrondiEntier(jours * heuresParJour * 60);
}

/** Jours-homme → heures (précision à la minute). */
export function joursVersHeures(jours: number, heuresParJour = HEURES_PAR_JOUR_DEFAUT): number {
  return joursVersMinutes(jours, heuresParJour) / 60;
}

/**
 * Arrondit une saisie (en jours) au pas de la granularité :
 * - `demi_journee` : au 0,5 jour le plus proche (0,25 → 0,5 ; 0,74 → 0,5) ;
 * - `heure` : à la minute la plus proche, puis au centième de jour.
 */
export function arrondirAuPas(
  jours: number,
  granularite: Granularite,
  heuresParJour = HEURES_PAR_JOUR_DEFAUT,
): number {
  if (granularite === "demi_journee") {
    const pas = arrondiEntier(versCentiemes(jours) / PAS_DEMI_JOURNEE);
    return depuisCentiemes(pas * PAS_DEMI_JOURNEE);
  }
  return heuresVersJours(joursVersMinutes(jours, heuresParJour) / 60, heuresParJour);
}

/**
 * Valide une saisie en jours : positive ou nulle, finie, et respectant le pas
 * (multiple de 0,5 en demi-journée ; nombre entier de minutes en heure).
 */
export function estPasValide(
  jours: number,
  granularite: Granularite,
  heuresParJour = HEURES_PAR_JOUR_DEFAUT,
): boolean {
  if (!Number.isFinite(jours) || jours < 0) return false;
  if (granularite === "demi_journee") {
    const c = jours * CENTIEMES_PAR_JOUR;
    return Math.abs(c - arrondiEntier(c)) < 1e-6 && arrondiEntier(c) % PAS_DEMI_JOURNEE === 0;
  }
  verifierHeuresParJour(heuresParJour);
  const minutes = jours * heuresParJour * 60;
  return Math.abs(minutes - arrondiEntier(minutes)) < 1e-6;
}
