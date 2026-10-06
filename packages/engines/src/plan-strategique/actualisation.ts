/**
 * Valeur actuelle nette et taux de rendement interne (PLA-07), en calcul
 * exact.
 *
 * - VAN = Σ F_t / (1 + a)^t, la première valeur étant actualisée à la période
 *   `premierePeriode` (1 par défaut : flux de fin d'année 1 ; 0 pour un
 *   investissement initial non actualisé). Arrondie une fois à l'unité mineure.
 * - TRI : taux r > −100 % qui annule la VAN, rendu en fraction arrondie à
 *   4 décimales (0,1 = 10 %). Il n'est défini (non `null`) que si la suite des
 *   flux non nuls change de signe exactement une fois : la règle des signes de
 *   Descartes garantit alors une racine unique. Il est obtenu par dichotomie
 *   exacte sur x = 1 + r au pas de 10⁻⁸, puis arrondi.
 */
import { ajouterRationnels, diviserArrondi, type Rationnel } from "../finance/calcul-exact";
import { ErreurPlan } from "./erreurs";
import { signe, unPlus, versEntier } from "./exact";

function validerFlux(flux: readonly number[]): bigint[] {
  return flux.map((f, i) => {
    if (!Number.isSafeInteger(f)) {
      throw new ErreurPlan(
        "FLUX_INVALIDES",
        `flux[${i}] : montant entier en unités mineures attendu (reçu ${f}).`,
        `flux[${i}]`,
      );
    }
    return BigInt(f);
  });
}

/**
 * VAN de flux annuels au taux `tauxPoints` (12 pour 12 %).
 * Exemple : [−1 000, 600, 600] dès la période 0 à 10 % → 41 (−1 000 + 545,45 + 495,87).
 */
export function valeurActuelleNette(
  flux: readonly number[],
  tauxPoints: number,
  premierePeriode: 0 | 1 = 1,
): number {
  const valeurs = validerFlux(flux);
  if (!Number.isFinite(tauxPoints) || tauxPoints <= -100) {
    throw new ErreurPlan(
      "FLUX_INVALIDES",
      `Taux d'actualisation > −100 attendu (reçu ${tauxPoints}).`,
      "tauxActualisation",
    );
  }
  const facteur = unPlus(tauxPoints);
  let total: Rationnel = { num: 0n, den: 1n };
  valeurs.forEach((f, index) => {
    const t = BigInt(index + premierePeriode);
    total = ajouterRationnels(total, { num: f * facteur.den ** t, den: facteur.num ** t });
  });
  return versEntier(diviserArrondi(total.num, total.den));
}

const PRECISION = 100_000_000n;

/**
 * Signe de Q(x) = Σ c_t x^(L−t) en x = X / PRECISION. Horner sur
 * PRECISION^L × Q(x) = Σ c_t × X^(L−t) × PRECISION^t, qui a le même signe.
 */
function signePolynome(coefficients: readonly bigint[], x: bigint): -1 | 0 | 1 {
  let acc = 0n;
  let echelle = 1n;
  for (const c of coefficients) {
    acc = acc * x + c * echelle;
    echelle *= PRECISION;
  }
  return signe(acc);
}

/**
 * TRI des flux (le décalage de période est sans effet sur le TRI).
 * Exemple : [−1 000, 1 100] → 0,1 ; [−1 000, 600, 600] → 0,1307.
 */
export function tauxRendementInterne(flux: readonly number[]): number | null {
  const valeurs = validerFlux(flux);
  const nonNuls = valeurs.filter((f) => f !== 0n);
  const changements = nonNuls.slice(1).filter((f, i) => signe(f) !== signe(nonNuls[i] as bigint));
  if (changements.length !== 1) return null;
  // Les zéros finaux ajoutent une racine x = 0 sans signification : on les retire.
  let dernier = valeurs.length - 1;
  while (valeurs[dernier] === 0n) dernier -= 1;
  const coefficients = valeurs.slice(0, dernier + 1);
  const signeQueue = signe(nonNuls[nonNuls.length - 1] as bigint);
  // En x = 0 le polynôme vaut le dernier flux ; quand x → ∞, il prend le signe du premier.
  let bas = 0n;
  let haut = PRECISION;
  while (signePolynome(coefficients, haut) === signeQueue) {
    bas = haut;
    haut *= 2n;
  }
  while (haut - bas > 1n) {
    const milieu = (bas + haut) / 2n;
    if (signePolynome(coefficients, milieu) === signeQueue) bas = milieu;
    else haut = milieu;
  }
  const r = diviserArrondi((haut - PRECISION) * 10_000n, PRECISION);
  return Number(r) / 10_000;
}
