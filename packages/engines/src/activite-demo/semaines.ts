/**
 * Calendrier de l'activité de démonstration (D2, DT2, DT11) : lundis d'un mois, semaines à générer
 * par la tâche mensuelle, tâches de suite, fenêtre du mois et libellés. Une semaine est désignée
 * par son lundi ; le jour d'exécution est toujours un paramètre (aucune horloge).
 */
import { analyserDateISO } from "../commun/dates";
import {
  type DateISO,
  type Periode,
  ajouterJours,
  jourSemaine,
  lundiDeLaSemaine,
  periodeDuMois,
  versJourUTC,
} from "../planning/dates";
import { PARAMETRES_ACTIVITE_DEMO, exigerLundiDemo } from "./parametres";

/** Noms des mois en français (table fixe : aucun `Intl`, résultat indépendant du serveur). */
const NOMS_MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/** Lundis compris dans le mois `AAAA-MM`, croissants (4 ou 5). */
export function lundisDuMoisDemo(mois: string): DateISO[] {
  const { debut, fin } = periodeDuMois(mois);
  const lundis: DateISO[] = [];
  let l = lundiDeLaSemaine(debut);
  if (l < debut) l = ajouterJours(l, 7);
  while (l <= fin) {
    lundis.push(l);
    l = ajouterJours(l, 7);
  }
  return lundis;
}

/** Dernier lundi du mois (un mois en compte toujours au moins quatre). */
function dernierLundi(mois: string): DateISO {
  const lundis = lundisDuMoisDemo(mois);
  return lundis[lundis.length - 1] as DateISO;
}

/**
 * Semaines (lundis croissants) que la tâche mensuelle du mois génère le jour `jour` : du lundi de la
 * semaine du 1er (qui peut tomber dans le mois précédent) jusqu'au lundi de la semaine de `jour`,
 * sans dépasser le dernier lundi du mois ; seules les `max` plus récentes sont gardées. Vide si
 * `jour` précède le 1er du mois.
 */
export function semainesAGenererDemo(
  mois: string,
  jour: DateISO,
  max: number = PARAMETRES_ACTIVITE_DEMO.semainesMax,
): DateISO[] {
  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError(`Nombre de semaines invalide : ${max} (entier positif attendu)`);
  }
  const { debut } = periodeDuMois(mois);
  versJourUTC(jour);
  if (jour < debut || max === 0) return [];
  const lundiJour = lundiDeLaSemaine(jour);
  const dernier = dernierLundi(mois);
  const fin = lundiJour < dernier ? lundiJour : dernier;
  const semaines: DateISO[] = [];
  for (let l = lundiDeLaSemaine(debut); l <= fin; l = ajouterJours(l, 7)) semaines.push(l);
  return semaines.slice(-max);
}

/** Lundis du mois postérieurs à la semaine de `jour` : ceux des tâches de suite à mettre en file. */
export function lundisRestantsDemo(mois: string, jour: DateISO): DateISO[] {
  const lundiJour = lundiDeLaSemaine(jour);
  return lundisDuMoisDemo(mois).filter((l) => l > lundiJour);
}

/** Vrai si `date` est un lundi valide du mois `mois` (charge d'une tâche de suite) ; ne lève jamais. */
export function estLundiDuMoisDemo(mois: string, date: DateISO): boolean {
  return analyserDateISO(date).valide && jourSemaine(date) === 1 && date.slice(0, 7) === mois;
}

/** Fenêtre du mois : du lundi de la semaine du 1er au dimanche de la semaine du dernier lundi. */
export function fenetreDuMoisDemo(mois: string): Periode {
  return {
    debut: lundiDeLaSemaine(periodeDuMois(mois).debut),
    fin: ajouterJours(dernierLundi(mois), 6),
  };
}

/**
 * Jour des événements (jalon, facture, encaissement) de la semaine de `lundi` : `jour` s'il tombe
 * dans cette semaine (semaine courante), sinon `null` (semaine rattrapée ou à venir, DT2).
 */
export function jourEvenementDemo(lundi: DateISO, jour: DateISO): DateISO | null {
  exigerLundiDemo(lundi);
  versJourUTC(jour);
  return jour >= lundi && jour <= ajouterJours(lundi, 6) ? jour : null;
}

/** Mois `AAAA-MM` d'une date. */
export function moisDeDateDemo(date: DateISO): string {
  versJourUTC(date);
  return date.slice(0, 7);
}

/** « novembre 2026 » pour `2026-11`. */
export function libelleMoisDemo(mois: string): string {
  periodeDuMois(mois);
  const nom = NOMS_MOIS[Number(mois.slice(5, 7)) - 1] as string;
  return `${nom} ${mois.slice(0, 4)}`;
}

/** « semaine du 26 octobre 2026 » ; le premier du mois s'écrit « 1er ». */
export function libelleSemaineDemo(lundi: DateISO): string {
  exigerLundiDemo(lundi);
  const jour = Number(lundi.slice(8, 10));
  return `semaine du ${jour === 1 ? "1er" : String(jour)} ${libelleMoisDemo(lundi.slice(0, 7))}`;
}
