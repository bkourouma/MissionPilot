/**
 * Avancement et discipline de saisie : respect des jalons, discipline de
 * saisie des feuilles de temps, clôture des périodes (TPS-09).
 * La date courante est toujours passée en paramètre.
 */
import {
  type DateISO,
  type Periode,
  dansPeriode,
  periodeDuMois,
  versJourUTC,
  verifierPeriode,
} from "./dates";

/** Ratio « réussis / attendus », `null` s'il n'y a rien d'attendu. */
export interface Ratio {
  readonly reussis: number;
  readonly attendus: number;
  readonly taux: number | null;
}

function ratio(reussis: number, attendus: number): Ratio {
  return { reussis, attendus, taux: attendus === 0 ? null : reussis / attendus };
}

/** Jalon de mission. */
export interface Jalon {
  readonly datePrevue: DateISO;
  /** Date d'atteinte réelle ; absente si le jalon n'est pas atteint. */
  readonly dateReelle?: DateISO | null;
}

/**
 * Respect des jalons = jalons tenus / jalons prévus. Un jalon est « prévu »
 * dès que sa date prévue est atteinte (≤ date courante) ; il est « tenu » s'il
 * a été atteint au plus tard à sa date prévue (+ tolérance en jours calendaires).
 */
export function respectJalons(
  jalons: readonly Jalon[],
  dateCourante: DateISO,
  toleranceJours = 0,
): Ratio {
  const aujourdHui = versJourUTC(dateCourante);
  const prevus = jalons.filter((j) => versJourUTC(j.datePrevue) <= aujourdHui);
  const tenus = prevus.filter(
    (j) =>
      j.dateReelle != null &&
      versJourUTC(j.dateReelle) <= aujourdHui &&
      versJourUTC(j.dateReelle) <= versJourUTC(j.datePrevue) + toleranceJours,
  );
  return ratio(tenus.length, prevus.length);
}

/** Feuille de temps attendue d'un collaborateur pour une semaine. */
export interface FeuilleAttendue {
  readonly dateLimite: DateISO;
  /** Date de soumission ; absente si la feuille n'est pas soumise. */
  readonly dateSoumission?: DateISO | null;
}

/**
 * Discipline de saisie = feuilles soumises dans les délais / feuilles
 * attendues. Une feuille est attendue dès que sa date limite est passée ou
 * atteinte (≤ date courante).
 */
export function disciplineSaisie(
  feuilles: readonly FeuilleAttendue[],
  dateCourante: DateISO,
): Ratio {
  const aujourdHui = versJourUTC(dateCourante);
  const attendues = feuilles.filter((f) => versJourUTC(f.dateLimite) <= aujourdHui);
  const aTemps = attendues.filter(
    (f) => f.dateSoumission != null && versJourUTC(f.dateSoumission) <= versJourUTC(f.dateLimite),
  );
  return ratio(aTemps.length, attendues.length);
}

/** Clôtures connues : périodes explicites et/ou mois clôturés (`AAAA-MM`). */
export interface Clotures {
  readonly periodesCloturees?: readonly Periode[];
  readonly moisClotures?: readonly string[];
}

/**
 * Indique si une saisie à cette date est encore modifiable : une période
 * clôturée est verrouillée (TPS-09) ; toute correction passe alors par le
 * circuit de correction tracée, hors de ce moteur.
 */
export function estDateSaisieModifiable(date: DateISO, clotures: Clotures): boolean {
  versJourUTC(date);
  const periodes = [
    ...(clotures.periodesCloturees ?? []),
    ...(clotures.moisClotures ?? []).map(periodeDuMois),
  ];
  return !periodes.some((p) => {
    verifierPeriode(p);
    return dansPeriode(date, p);
  });
}
