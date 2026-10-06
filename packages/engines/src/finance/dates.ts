/**
 * Dates calendaires du domaine finance, au format ISO « AAAA-MM-JJ ».
 *
 * Aucune horloge cachée : la date du jour est toujours un paramètre. Les
 * calculs se font en UTC (une date calendaire n'a pas de fuseau), ce qui rend
 * le résultat identique quel que soit le serveur. Le calcul vit dans
 * commun/dates.ts (partagé avec le planning) ; ce module lève des
 * `ErreurFinance` de code `DATE_INVALIDE`.
 */
import {
  type DateISO,
  analyserDateISO,
  dateISODepuisJourUTC,
  jourUTCDepuisComposantes,
} from "../commun/dates";
import { ErreurFinance } from "./erreurs";

export type { DateISO };

/** Convertit une date ISO en nombre de jours depuis l'époque Unix ; refuse une date inexistante. */
export function joursDepuisEpoque(date: DateISO): number {
  const analyse = analyserDateISO(date);
  if (analyse.valide) return analyse.jourUTC;
  if (analyse.raison === "format") {
    throw new ErreurFinance(
      "DATE_INVALIDE",
      `Date attendue au format AAAA-MM-JJ (reçu « ${date} »).`,
    );
  }
  throw new ErreurFinance("DATE_INVALIDE", `Date inexistante « ${date} ».`);
}

/** Nombre de jours de `debut` à `fin` (négatif si `fin` précède `debut`). */
export function joursEntre(debut: DateISO, fin: DateISO): number {
  return joursDepuisEpoque(fin) - joursDepuisEpoque(debut);
}

/**
 * Ajoute `n` mois à une date ; le jour est ramené au dernier jour du mois
 * d'arrivée s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février).
 */
export function ajouterMois(date: DateISO, n: number): DateISO {
  joursDepuisEpoque(date);
  const [annee, mois, jour] = date.split("-").map(Number) as [number, number, number];
  const indexMois = annee * 12 + (mois - 1) + n;
  const anneeCible = Math.floor(indexMois / 12);
  const moisCible = indexMois - anneeCible * 12 + 1;
  // Jour 0 du mois suivant = dernier jour du mois cible.
  const dernierJour = Number(
    dateISODepuisJourUTC(jourUTCDepuisComposantes(anneeCible, moisCible + 1, 0)).slice(-2),
  );
  return dateISODepuisJourUTC(
    jourUTCDepuisComposantes(anneeCible, moisCible, Math.min(jour, dernierJour)),
  );
}
