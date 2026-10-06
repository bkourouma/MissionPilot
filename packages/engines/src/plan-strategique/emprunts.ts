/**
 * Échéancier des emprunts du plan (annuités de fin d'année).
 *
 * - Un emprunt débloqué l'année k (k ≥ 1) encaisse son capital en début
 *   d'année k et paie sa première échéance en fin d'année k. Un emprunt en
 *   cours à l'ouverture (k = 0) paie sa première échéance en fin d'année 1.
 * - Les `differe` premières échéances ne portent que les intérêts ; le capital
 *   s'amortit sur les `duree − differe` échéances suivantes.
 * - Annuités constantes : A = C × i / (1 − (1 + i)^−m), arrondie une fois ;
 *   intérêts de l'année = capital restant dû × i (arrondi) ; amortissement =
 *   A − intérêts ; la dernière échéance solde le capital restant dû, ce qui
 *   absorbe les arrondis. À taux nul, l'amortissement est constant.
 * - Amortissement constant : C / m tronqué, le reste sur la dernière échéance.
 *
 * Exemple : 1 000 000 à 10 % sur 2 ans → annuité 576 190 ; année 1 : intérêts
 * 100 000, capital 476 190 ; année 2 : intérêts 52 381, capital 523 810.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { minimum, pourcent, puissance, versEntier } from "./exact";
import {
  normaliserEmprunt,
  validerEmprunt,
  type EmpruntNormalise,
  type EmpruntPlan,
} from "./hypotheses";

export interface EcheanceEmprunt {
  /** Rang de l'échéance (1, 2, …). */
  readonly rang: number;
  /** Année du plan où l'échéance est payée (peut dépasser l'horizon). */
  readonly annee: number;
  readonly capitalDebut: number;
  readonly interets: number;
  readonly amortissement: number;
  readonly annuite: number;
  readonly capitalFin: number;
}

export interface EcheancierEmprunt {
  readonly libelle: string;
  readonly anneeDeblocage: number;
  readonly montant: number;
  readonly echeances: readonly EcheanceEmprunt[];
  readonly totalInterets: number;
}

/** Échéances en `bigint` pour le calcul des états. */
export interface EcheanceExacte {
  readonly annee: number;
  readonly interets: bigint;
  readonly amortissement: bigint;
  readonly capitalFin: bigint;
}

/** Calcule l'échéancier exact d'un emprunt déjà validé. */
export function echeancesExactes(e: EmpruntNormalise): EcheanceExacte[] {
  const i = pourcent(e.tauxAnnuel);
  const capital = BigInt(e.montant);
  const m = e.duree - e.differe;
  const premiereAnnee = Math.max(e.anneeDeblocage, 1);
  const constant = e.mode === "amortissement_constant" || i.num === 0n;
  // (1 + i)^m = (den + num)^m / den^m ; A = C × num × (den+num)^m / (den × ((den+num)^m − den^m))
  const croissance = puissance({ num: i.den + i.num, den: i.den }, m);
  const annuite = constant
    ? 0n
    : diviserArrondi(capital * i.num * croissance.num, i.den * (croissance.num - croissance.den));
  const partConstante = capital / BigInt(m);
  const echeances: EcheanceExacte[] = [];
  let restant = capital;
  for (let rang = 1; rang <= e.duree; rang += 1) {
    const interets = diviserArrondi(restant * i.num, i.den);
    const derniere = rang === e.duree;
    let amortissement = 0n;
    if (rang > e.differe) {
      amortissement = derniere
        ? restant
        : minimum(restant, constant ? partConstante : annuite - interets);
    }
    restant -= amortissement;
    echeances.push({
      annee: premiereAnnee + rang - 1,
      interets,
      amortissement,
      capitalFin: restant,
    });
  }
  return echeances;
}

/**
 * Échéancier complet d'un emprunt (toutes les échéances, y compris au-delà de
 * l'horizon du plan).
 */
export function echeancierEmprunt(emprunt: EmpruntPlan): EcheancierEmprunt {
  const e = normaliserEmprunt(emprunt);
  validerEmprunt(e, "emprunt", Number.MAX_SAFE_INTEGER);
  return construireEcheancier(e);
}

export function construireEcheancier(e: EmpruntNormalise): EcheancierEmprunt {
  let capitalDebut = BigInt(e.montant);
  const echeances = echeancesExactes(e).map((x, index) => {
    const ligne: EcheanceEmprunt = {
      rang: index + 1,
      annee: x.annee,
      capitalDebut: versEntier(capitalDebut),
      interets: versEntier(x.interets),
      amortissement: versEntier(x.amortissement),
      annuite: versEntier(x.interets + x.amortissement),
      capitalFin: versEntier(x.capitalFin),
    };
    capitalDebut = x.capitalFin;
    return ligne;
  });
  return {
    libelle: e.libelle,
    anneeDeblocage: e.anneeDeblocage,
    montant: e.montant,
    echeances,
    totalInterets: echeances.reduce((s, x) => s + x.interets, 0),
  };
}
