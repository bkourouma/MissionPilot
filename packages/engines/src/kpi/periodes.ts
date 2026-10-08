/**
 * Périodes de mesure d'un KPI (fréquence de KPI-01).
 *
 * Une période est repérée par son rang, entier croissant sans trou pour une
 * fréquence donnée : deux périodes consécutives ont des rangs consécutifs.
 * Clés lisibles :
 * - hebdomadaire  : semaine ISO 8601, « 2026-W41 » (lundi → dimanche,
 *   l'année est celle du jeudi de la semaine) ;
 * - mensuelle     : « 2026-03 » ;
 * - trimestrielle : « 2026-T1 » ;
 * - semestrielle  : « 2026-S1 » ;
 * - annuelle      : « 2026 ».
 * Dates civiles UTC (commun/dates.ts), aucune horloge.
 */
import {
  analyserDateISO,
  dateISODepuisJourUTC,
  jourSemaineDepuisJourUTC,
  jourUTCDepuisComposantes,
  type DateISO,
} from "../commun/dates";
import { ErreurKpi } from "./erreurs";

export type FrequenceKpi =
  "hebdomadaire" | "mensuelle" | "trimestrielle" | "semestrielle" | "annuelle";

export interface PeriodeKpi {
  readonly frequence: FrequenceKpi;
  readonly cle: string;
  readonly rang: number;
  readonly debut: DateISO;
  readonly fin: DateISO;
}

/** Nombre maximal de périodes produites par une énumération. */
export const MAX_PERIODES_KPI = 10_000;

const MOIS_PAR_PERIODE: Readonly<Record<Exclude<FrequenceKpi, "hebdomadaire">, number>> = {
  mensuelle: 1,
  trimestrielle: 3,
  semestrielle: 6,
  annuelle: 12,
};

/** Le 1970-01-05 (jour UTC 4) est le premier lundi de l'ère : rang 0 des semaines. */
const PREMIER_LUNDI = 4;

/** Jour UTC d'une date ISO valide ; `DATE_INVALIDE` sinon. */
export function jourKpi(date: string, nom = "La date"): number {
  const analyse = analyserDateISO(date);
  if (!analyse.valide) {
    throw new ErreurKpi("DATE_INVALIDE", `${nom} n'est pas une date AAAA-MM-JJ valide (${date}).`);
  }
  return analyse.jourUTC;
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

function anneeDe(jourUTC: number): number {
  return Number(dateISODepuisJourUTC(jourUTC).slice(0, 4));
}

function moisDe(jourUTC: number): number {
  return Number(dateISODepuisJourUTC(jourUTC).slice(5, 7));
}

function semaine(rang: number): PeriodeKpi {
  const lundi = rang * 7 + PREMIER_LUNDI;
  const jeudi = lundi + 3;
  const annee = anneeDe(jeudi);
  const numero = Math.floor((jeudi - jourUTCDepuisComposantes(annee, 1, 1)) / 7) + 1;
  return {
    frequence: "hebdomadaire",
    cle: `${String(annee).padStart(4, "0")}-W${deuxChiffres(numero)}`,
    rang,
    debut: dateISODepuisJourUTC(lundi),
    fin: dateISODepuisJourUTC(lundi + 6),
  };
}

function cleCalendaire(frequence: FrequenceKpi, annee: number, index: number): string {
  const an = String(annee).padStart(4, "0");
  if (frequence === "mensuelle") return `${an}-${deuxChiffres(index + 1)}`;
  if (frequence === "trimestrielle") return `${an}-T${index + 1}`;
  if (frequence === "semestrielle") return `${an}-S${index + 1}`;
  return an;
}

/** Période d'une fréquence donnée par son rang. */
export function periodeKpiDepuisRang(frequence: FrequenceKpi, rang: number): PeriodeKpi {
  if (!Number.isSafeInteger(rang)) {
    throw new ErreurKpi("PERIODE_INVALIDE", `Le rang de période doit être un entier (${rang}).`);
  }
  if (frequence === "hebdomadaire") return semaine(rang);
  const mois = MOIS_PAR_PERIODE[frequence];
  const parAn = 12 / mois;
  const annee = Math.floor(rang / parAn);
  const index = rang - annee * parAn;
  const moisDebut = index * mois + 1;
  return {
    frequence,
    cle: cleCalendaire(frequence, annee, index),
    rang,
    debut: dateISODepuisJourUTC(jourUTCDepuisComposantes(annee, moisDebut, 1)),
    fin: dateISODepuisJourUTC(jourUTCDepuisComposantes(annee, moisDebut + mois, 0)),
  };
}

/** Rang de la période qui contient le jour UTC donné. */
export function rangKpiDuJour(jourUTC: number, frequence: FrequenceKpi): number {
  if (frequence === "hebdomadaire") {
    const lundi = jourUTC - (jourSemaineDepuisJourUTC(jourUTC) - 1);
    return (lundi - PREMIER_LUNDI) / 7;
  }
  const mois = MOIS_PAR_PERIODE[frequence];
  return anneeDe(jourUTC) * (12 / mois) + Math.floor((moisDe(jourUTC) - 1) / mois);
}

/** Période qui contient `date`. */
export function periodeKpiDe(date: DateISO, frequence: FrequenceKpi): PeriodeKpi {
  return periodeKpiDepuisRang(frequence, rangKpiDuJour(jourKpi(date), frequence));
}

export function periodeKpiSuivante(periode: PeriodeKpi): PeriodeKpi {
  return periodeKpiDepuisRang(periode.frequence, periode.rang + 1);
}

export function periodeKpiPrecedente(periode: PeriodeKpi): PeriodeKpi {
  return periodeKpiDepuisRang(periode.frequence, periode.rang - 1);
}

/** Nombre de jours civils d'une période (bornes incluses). */
export function joursDansPeriodeKpi(periode: PeriodeKpi): number {
  return jourKpi(periode.fin) - jourKpi(periode.debut) + 1;
}

/** Périodes successives de celle de `du` à celle de `au`, incluses. */
export function periodesKpiEntre(du: DateISO, au: DateISO, frequence: FrequenceKpi): PeriodeKpi[] {
  const premier = rangKpiDuJour(jourKpi(du, "Le début"), frequence);
  const dernier = rangKpiDuJour(jourKpi(au, "La fin"), frequence);
  return periodesKpiParRang(premier, dernier, frequence);
}

export function periodesKpiParRang(
  premier: number,
  dernier: number,
  frequence: FrequenceKpi,
): PeriodeKpi[] {
  if (dernier < premier) {
    throw new ErreurKpi("PERIODE_INVALIDE", "La fin de l'intervalle précède son début.");
  }
  if (dernier - premier + 1 > MAX_PERIODES_KPI) {
    throw new ErreurKpi(
      "PERIODE_INVALIDE",
      `L'intervalle dépasse ${MAX_PERIODES_KPI} périodes ; réduisez-le.`,
    );
  }
  const periodes: PeriodeKpi[] = [];
  for (let rang = premier; rang <= dernier; rang++) {
    periodes.push(periodeKpiDepuisRang(frequence, rang));
  }
  return periodes;
}
