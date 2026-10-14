/**
 * Outils communs du moteur de redressement : aucun I/O, aucune horloge, aucune virgule
 * flottante dans un résultat. Les sommes et produits passent par `BigInt` ; tout résultat
 * hors `Number.MAX_SAFE_INTEGER` lève `SOMME_HORS_LIMITES`.
 */
import { analyserDateISO, jourSemaineDepuisJourUTC, type DateISO } from "../commun/dates";
import { diviserArrondi } from "../finance/calcul-exact";
import { ErreurRedressement, type CodeErreurRedressement } from "./erreurs";

/** Version du moteur de redressement (un changement de règle de calcul l'incrémente). */
export const VERSION_MOTEUR_REDRESSEMENT = 1;

/** Plafond d'un flux, d'une dette ou d'un solde de ce lot (unités mineures) : 10^13. */
export const MONTANT_RED_MAX = 10_000_000_000_000;

/** Points de base : 10 000 = 1. */
export const PB = 10_000n;

/** Base de jours (BFR, point mort, leviers), alignée sur le modèle financier. */
export const JOURS_PAR_AN = 360n;

const MAX_SUR = BigInt(Number.MAX_SAFE_INTEGER);

/** `BigInt` → `number`, en refusant tout dépassement de la plage entière sûre. */
export function versNombreSur(valeur: bigint): number {
  if (valeur > MAX_SUR || valeur < -MAX_SUR) {
    throw new ErreurRedressement("SOMME_HORS_LIMITES", "Résultat hors des limites calculables.");
  }
  return Number(valeur);
}

/** Division entière arrondie (demi s'éloignant de zéro). Le dénominateur doit être non nul. */
export function quotientArrondi(num: bigint, den: bigint): bigint {
  return diviserArrondi(num, den);
}

/** `num × 10 000 / den` en points de base, arrondi, rendu en `number`. */
export function rapportPb(num: bigint, den: bigint): number {
  return versNombreSur(diviserArrondi(num * PB, den));
}

/** Entier sûr, dans [min, max] ; sinon l'erreur de code donné (message sans valeur). */
export function exigerEntier(
  valeur: unknown,
  min: number,
  max: number,
  code: CodeErreurRedressement,
  nom: string,
): number {
  if (
    typeof valeur !== "number" ||
    !Number.isSafeInteger(valeur) ||
    (valeur as number) < min ||
    (valeur as number) > max
  ) {
    throw new ErreurRedressement(code, `${nom} : entier entre ${min} et ${max} attendu.`);
  }
  return valeur;
}

/** Jour UTC d'une date ISO valide ; sinon `DATE_INVALIDE` (jamais une `RangeError`). */
export function jourDe(date: DateISO, nom = "date"): number {
  const analyse = typeof date === "string" ? analyserDateISO(date) : null;
  if (analyse === null || !analyse.valide) {
    throw new ErreurRedressement("DATE_INVALIDE", `${nom} : date AAAA-MM-JJ valide attendue.`);
  }
  return analyse.jourUTC;
}

/** Jour UTC d'un lundi valide ; sinon `DATE_INVALIDE`. */
export function jourDeLundi(date: DateISO, nom = "date"): number {
  const jour = jourDe(date, nom);
  if (jourSemaineDepuisJourUTC(jour) !== 1) {
    throw new ErreurRedressement("DATE_INVALIDE", `${nom} : un lundi est attendu.`);
  }
  return jour;
}

/** Somme de `BigInt` : utilitaire de lisibilité. */
export function somme(valeurs: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of valeurs) total += v;
  return total;
}
