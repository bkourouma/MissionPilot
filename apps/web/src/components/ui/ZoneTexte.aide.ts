/** Logique pure du compteur de caractères d'une zone de texte (testée sans rendu DOM). */

export interface EtatCompteur {
  longueur: number;
  /** Caractères restants (undefined sans limite). */
  restants: number | undefined;
  /** Au-delà de 90 % de la limite : le compteur passe en évidence. */
  proche: boolean;
  /** Limite atteinte ou dépassée. */
  atteint: boolean;
}

export function etatCompteur(longueur: number, max?: number): EtatCompteur {
  const l = Math.max(0, Math.floor(longueur));
  if (max === undefined || !Number.isFinite(max) || max <= 0) {
    return { longueur: l, restants: undefined, proche: false, atteint: false };
  }
  return {
    longueur: l,
    restants: Math.max(0, max - l),
    proche: l >= max * 0.9,
    atteint: l >= max,
  };
}

/** Longueur d'une valeur de zone de texte (unités UTF-16, comme `maxLength`). */
export function longueurSaisie(valeur: string | number | readonly string[] | undefined): number {
  if (valeur === undefined) return 0;
  if (typeof valeur === "string") return valeur.length;
  if (typeof valeur === "number") return String(valeur).length;
  return valeur.join("\n").length;
}
