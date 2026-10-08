/**
 * Dates civiles au format ISO `AAAA-MM-JJ`, manipulées en jours entiers UTC
 * (nombre de jours depuis le 1970-01-01). Aucun fuseau local, aucune horloge :
 * la date courante est toujours fournie par l'appelant. Le calcul vit dans
 * commun/dates.ts (partagé avec la finance) ; ce module lève des `RangeError`.
 */
import {
  type DateISO,
  analyserDateISO,
  dateISODepuisJourUTC,
  jourSemaineDepuisJourUTC,
} from "../commun/dates";

export type { DateISO };

/** Intervalle de dates, bornes incluses. */
export interface Periode {
  readonly debut: DateISO;
  readonly fin: DateISO;
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

/** Construit une date ISO à partir de l'année, du mois (1-12) et du jour. */
export function dateISO(annee: number, mois: number, jour: number): DateISO {
  const a = String(annee).padStart(4, "0");
  return versDateISO(versJourUTC(`${a}-${deuxChiffres(mois)}-${deuxChiffres(jour)}`));
}

/** Convertit une date ISO en numéro de jour UTC ; lève une `RangeError` si invalide. */
export function versJourUTC(date: DateISO): number {
  const analyse = analyserDateISO(date);
  if (analyse.valide) return analyse.jourUTC;
  if (analyse.raison === "format") {
    throw new RangeError(`Date ISO invalide : « ${date} » (attendu AAAA-MM-JJ)`);
  }
  throw new RangeError(`Date inexistante : « ${date} »`);
}

/** Convertit un numéro de jour UTC en date ISO. */
export function versDateISO(jourUTC: number): DateISO {
  return dateISODepuisJourUTC(jourUTC);
}

/** Ajoute (ou retire si négatif) un nombre de jours calendaires. */
export function ajouterJours(date: DateISO, jours: number): DateISO {
  return versDateISO(versJourUTC(date) + jours);
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function jourSemaine(date: DateISO): number {
  return jourSemaineDepuisJourUTC(versJourUTC(date));
}

/** Écart en jours calendaires `b − a`. */
export function ecartJours(a: DateISO, b: DateISO): number {
  return versJourUTC(b) - versJourUTC(a);
}

/** Lève une `RangeError` si la période est inversée ou mal formée. */
export function verifierPeriode(periode: Periode): void {
  if (versJourUTC(periode.fin) < versJourUTC(periode.debut)) {
    throw new RangeError(`Période inversée : ${periode.debut} > ${periode.fin}`);
  }
}

/** Indique si la date appartient à la période (bornes incluses). */
export function dansPeriode(date: DateISO, periode: Periode): boolean {
  const j = versJourUTC(date);
  return j >= versJourUTC(periode.debut) && j <= versJourUTC(periode.fin);
}

/** Intersection de deux périodes, ou `null` si elles sont disjointes. */
export function intersection(a: Periode, b: Periode): Periode | null {
  const debut = Math.max(versJourUTC(a.debut), versJourUTC(b.debut));
  const fin = Math.min(versJourUTC(a.fin), versJourUTC(b.fin));
  return debut > fin ? null : { debut: versDateISO(debut), fin: versDateISO(fin) };
}

/** Lundi de la semaine ISO contenant la date. */
export function lundiDeLaSemaine(date: DateISO): DateISO {
  return ajouterJours(date, 1 - jourSemaine(date));
}

/** Période couvrant un mois civil donné au format `AAAA-MM`. */
export function periodeDuMois(mois: string): Periode {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  const numero = m ? Number(m[2]) : 0;
  if (!m || numero < 1 || numero > 12) {
    throw new RangeError(`Mois invalide : « ${mois} » (attendu AAAA-MM)`);
  }
  const annee = Number(m[1]);
  const debut = dateISO(annee, numero, 1);
  const suivant = numero === 12 ? dateISO(annee + 1, 1, 1) : dateISO(annee, numero + 1, 1);
  return { debut, fin: ajouterJours(suivant, -1) };
}
