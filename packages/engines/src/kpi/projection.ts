/**
 * Projection linéaire simple d'un KPI à la fin d'une période en cours.
 *
 * - Flux : prorata temporel du cumul. Cumul des mesures datées du début de la
 *   période à la date de référence incluse, multiplié par
 *   jours de la période / jours écoulés (bornes incluses).
 * - Stock : droite des moindres carrés sur les mesures datées jusqu'à la date
 *   de référence (l'appelant choisit l'historique fourni), évaluée au dernier
 *   jour de la période. Une seule date mesurée : la valeur est reconduite
 *   (moyenne si plusieurs mesures à cette date).
 * Après la fin de période, la date de référence est ramenée à la fin : la
 * projection vaut alors le réalisé. Aucune mesure exploitable : `null`.
 */
import type { DateISO } from "../commun/dates";
import { ErreurKpi } from "./erreurs";
import type { MesureKpi, NatureKpi } from "./agregation";
import {
  ajouter,
  arrondir,
  depuisNombre,
  diviser,
  entier,
  multiplier,
  somme,
  versTexte,
  type Fraction,
} from "./fraction";
import { jourKpi } from "./periodes";
import { regressionExacte, type PointExact } from "./tendance";

export interface OptionsProjectionKpi {
  readonly nature: NatureKpi;
  /** Premier jour de la période projetée. */
  readonly debut: DateISO;
  /** Dernier jour de la période projetée. */
  readonly fin: DateISO;
  /** Date d'arrêté des mesures (≥ début). */
  readonly dateReference: DateISO;
}

export type MethodeProjectionKpi = "prorata" | "regression" | "reconduction" | "aucune";

export interface ProjectionKpi {
  /** Valeur projetée à la fin de période, 4 décimales ; `null` sans mesure. */
  readonly valeurProjetee: number | null;
  readonly valeurExacte: string | null;
  readonly methode: MethodeProjectionKpi;
  readonly joursEcoules: number;
  readonly joursTotal: number;
}

interface Cadre {
  readonly debut: number;
  readonly fin: number;
  readonly reference: number;
}

function cadre(options: OptionsProjectionKpi): Cadre {
  const debut = jourKpi(options.debut, "Le début de période");
  const fin = jourKpi(options.fin, "La fin de période");
  const reference = jourKpi(options.dateReference, "La date de référence");
  if (fin < debut) {
    throw new ErreurKpi("PERIODE_INVALIDE", "La fin de période précède son début.");
  }
  if (reference < debut) {
    throw new ErreurKpi("PERIODE_INVALIDE", "La date de référence précède le début de période.");
  }
  return { debut, fin, reference: Math.min(reference, fin) };
}

interface ValeurProjetee {
  readonly valeur: Fraction;
  readonly methode: MethodeProjectionKpi;
}

function projeterFlux(points: readonly PointExact[], c: Cadre): ValeurProjetee | null {
  const dansPeriode = points.filter((p) => p.x.num >= 0n);
  if (dansPeriode.length === 0) return null;
  const cumul = somme(dansPeriode.map((p) => p.y));
  const valeur = diviser(
    multiplier(cumul, entier(c.fin - c.debut + 1)),
    entier(c.reference - c.debut + 1),
  );
  return { valeur, methode: "prorata" };
}

function projeterStock(points: readonly PointExact[], c: Cadre): ValeurProjetee | null {
  if (points.length === 0) return null;
  const droite = regressionExacte(points);
  if (droite === null) {
    const moyenne = diviser(somme(points.map((p) => p.y)), entier(points.length));
    return { valeur: moyenne, methode: "reconduction" };
  }
  const valeur = ajouter(droite.ordonnee, multiplier(droite.pente, entier(c.fin - c.debut)));
  return { valeur, methode: "regression" };
}

/** Projette la valeur d'un KPI à la fin de la période en cours. */
export function projeterKpiFinPeriode(
  mesures: readonly MesureKpi[],
  options: OptionsProjectionKpi,
): ProjectionKpi {
  const c = cadre(options);
  const points: PointExact[] = [];
  mesures.forEach((m, i) => {
    const jour = jourKpi(m.date, `La date de la mesure ${i + 1}`);
    const y = depuisNombre(m.valeur, `La valeur de la mesure ${i + 1}`);
    if (jour <= c.reference) points.push({ x: entier(jour - c.debut), y });
  });
  const jours = { joursEcoules: c.reference - c.debut + 1, joursTotal: c.fin - c.debut + 1 };
  const resultat = options.nature === "flux" ? projeterFlux(points, c) : projeterStock(points, c);
  if (resultat === null) {
    return { valeurProjetee: null, valeurExacte: null, methode: "aucune", ...jours };
  }
  return {
    valeurProjetee: arrondir(resultat.valeur),
    valeurExacte: versTexte(resultat.valeur),
    methode: resultat.methode,
    ...jours,
  };
}
