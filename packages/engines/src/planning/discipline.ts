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
import { ratioArrondi } from "../commun/ratio";

/** Ratio « réussis / attendus », `null` s'il n'y a rien d'attendu. */
export interface Ratio {
  readonly reussis: number;
  readonly attendus: number;
  readonly taux: number | null;
}

/** Élément à évaluer : date limite et date de réalisation, en jours UTC. */
interface Echeance {
  readonly limite: number;
  readonly realisation: number | null;
}

/**
 * Règle commune aux jalons et aux feuilles de temps (choix documenté) :
 * - un élément réalisé (date de réalisation ≤ date courante) compte parmi les
 *   attendus dès sa réalisation, même avant sa date limite ;
 * - un élément non réalisé n'est attendu qu'à partir du LENDEMAIN de sa date
 *   limite (limite < date courante) : le jour même de l'échéance, il peut
 *   encore être réalisé à temps et ne compte donc pas comme un échec ;
 * - un élément est réussi s'il est réalisé au plus tard à sa date limite.
 * Une date de réalisation postérieure à la date courante est ignorée.
 * Le taux est arrondi à 4 décimales (commun/ratio.ts).
 */
function evaluer(elements: readonly Echeance[], aujourdHui: number): Ratio {
  let attendus = 0;
  let reussis = 0;
  for (const e of elements) {
    const r = e.realisation;
    const realise = r !== null && r <= aujourdHui;
    if (!realise && e.limite >= aujourdHui) continue;
    attendus++;
    if (realise && r <= e.limite) reussis++;
  }
  return { reussis, attendus, taux: ratioArrondi(reussis, attendus) };
}

function jourOuNull(date: DateISO | null | undefined): number | null {
  return date == null ? null : versJourUTC(date);
}

/** Jalon de mission. */
export interface Jalon {
  readonly datePrevue: DateISO;
  /** Date d'atteinte réelle ; absente si le jalon n'est pas atteint. */
  readonly dateReelle?: DateISO | null;
}

/**
 * Respect des jalons = jalons tenus / jalons prévus. La date limite d'un jalon
 * est sa date prévue + la tolérance (jours calendaires) ; un jalon atteint est
 * prévu dès son atteinte, un jalon non atteint à partir du lendemain de sa date
 * limite (voir `evaluer`). Il est « tenu » s'il a été atteint au plus tard à
 * sa date limite.
 */
export function respectJalons(
  jalons: readonly Jalon[],
  dateCourante: DateISO,
  toleranceJours = 0,
): Ratio {
  return evaluer(
    jalons.map((j) => ({
      limite: versJourUTC(j.datePrevue) + toleranceJours,
      realisation: jourOuNull(j.dateReelle),
    })),
    versJourUTC(dateCourante),
  );
}

/** Feuille de temps attendue d'un collaborateur pour une semaine. */
export interface FeuilleAttendue {
  readonly dateLimite: DateISO;
  /** Date de soumission ; absente si la feuille n'est pas soumise. */
  readonly dateSoumission?: DateISO | null;
}

/**
 * Discipline de saisie = feuilles soumises dans les délais / feuilles
 * attendues. Une feuille soumise est attendue dès sa soumission ; une feuille
 * non soumise à partir du lendemain de sa date limite (voir `evaluer`).
 */
export function disciplineSaisie(
  feuilles: readonly FeuilleAttendue[],
  dateCourante: DateISO,
): Ratio {
  return evaluer(
    feuilles.map((f) => ({
      limite: versJourUTC(f.dateLimite),
      realisation: jourOuNull(f.dateSoumission),
    })),
    versJourUTC(dateCourante),
  );
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
