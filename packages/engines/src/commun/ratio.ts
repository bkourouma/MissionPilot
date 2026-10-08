/**
 * Convention d'arrondi des ratios exposés (taux d'occupation, consommation,
 * écart relatif, discipline…) : fraction arrondie à 4 décimales, demi
 * s'éloignant de zéro, comme `ratio` de finance/calcul-exact.ts. Les seuils se
 * comparent sur les valeurs exactes (entiers) ; l'arrondi n'intervient qu'en
 * sortie.
 */

const DIX_MILLE = 10_000;

/**
 * Arrondit un ratio à 4 décimales (0,83333… → 0,8333 ; 0,00005 → 0,0001 ;
 * −0,16666… → −0,1667). Le passage par `toFixed(8)` neutralise le bruit
 * flottant (0,00005 × 10 000 = 0,49999… → 0,5).
 */
export function arrondirRatio(x: number): number {
  const absolu = Math.round(Number(Math.abs(x * DIX_MILLE).toFixed(8)));
  return absolu === 0 ? 0 : (Math.sign(x) * absolu) / DIX_MILLE;
}

/** `numerateur / denominateur` arrondi à 4 décimales, `null` si le dénominateur est nul. */
export function ratioArrondi(numerateur: number, denominateur: number): number | null {
  return denominateur === 0 ? null : arrondirRatio(numerateur / denominateur);
}
