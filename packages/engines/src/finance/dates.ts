/**
 * Dates calendaires du domaine finance, au format ISO « AAAA-MM-JJ ».
 *
 * Aucune horloge cachée : la date du jour est toujours un paramètre. Les
 * calculs se font en UTC (une date calendaire n'a pas de fuseau), ce qui rend
 * le résultat identique quel que soit le serveur.
 */
import { ErreurFinance } from "./erreurs";

const MS_PAR_JOUR = 86_400_000;
const FORMAT_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date ISO « AAAA-MM-JJ ». */
export type DateIso = string;

/** Convertit une date ISO en nombre de jours depuis l'époque Unix ; refuse une date inexistante. */
export function joursDepuisEpoque(date: DateIso): number {
  const correspondance = FORMAT_ISO.exec(date);
  if (correspondance === null) {
    throw new ErreurFinance(
      "DATE_INVALIDE",
      `Date attendue au format AAAA-MM-JJ (reçu « ${date} »).`,
    );
  }
  const [annee, mois, jour] = correspondance.slice(1).map(Number) as [number, number, number];
  const ms = Date.UTC(annee, mois - 1, jour);
  if (formaterDate(ms) !== date) {
    throw new ErreurFinance("DATE_INVALIDE", `Date inexistante « ${date} ».`);
  }
  return ms / MS_PAR_JOUR;
}

function formaterDate(ms: number): DateIso {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Nombre de jours de `debut` à `fin` (négatif si `fin` précède `debut`). */
export function joursEntre(debut: DateIso, fin: DateIso): number {
  return joursDepuisEpoque(fin) - joursDepuisEpoque(debut);
}

/**
 * Ajoute `n` mois à une date ; le jour est ramené au dernier jour du mois
 * d'arrivée s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février).
 */
export function ajouterMois(date: DateIso, n: number): DateIso {
  joursDepuisEpoque(date);
  const [annee, mois, jour] = date.split("-").map(Number) as [number, number, number];
  const indexMois = annee * 12 + (mois - 1) + n;
  const anneeCible = Math.floor(indexMois / 12);
  const moisCible = indexMois - anneeCible * 12;
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  return formaterDate(Date.UTC(anneeCible, moisCible, Math.min(jour, dernierJour)));
}
