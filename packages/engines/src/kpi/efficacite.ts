/**
 * Efficacité d'une action corrective (KPI-18) : variation du KPI AVANT et
 * APRÈS l'action, sur les périodes closes.
 *
 * - Sélection (`selectionnerPeriodesAvantApres`) : « avant » = les `fenetre`
 *   périodes qui se terminent avant la date d'effet ; « après » = les `fenetre`
 *   premières périodes qui commencent à la date d'effet ou après. La période
 *   qui contient la date d'effet est exclue des deux côtés (mélange des
 *   situations). Seules les périodes closes et mesurées comptent.
 * - Mesure (`mesurerEfficaciteActionKpi`) : moyennes exactes avant et après,
 *   variation absolue et relative, variation ORIENTÉE par le sens de lecture
 *   (positive = mieux). Verdict : « efficace » si la variation orientée dépasse
 *   la tolérance, « inefficace » si elle la dépasse en sens inverse, « neutre »
 *   sinon, « indeterminee » tant que chaque côté n'a pas `minimumParCote`
 *   périodes mesurées.
 *
 * Une variation avant/après est une CORRÉLATION dans le temps, pas une preuve
 * de causalité : l'interface le dit. Tolérance relative 2 % comme la tendance.
 * Fonctions pures, arithmétique exacte, sorties à 4 décimales.
 */
import type { DateISO } from "../commun/dates";
import type { SensLectureKpi } from "./atteinte";
import { ErreurKpi } from "./erreurs";
import {
  ZERO,
  absolu,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  entier,
  estNul,
  multiplier,
  oppose,
  soustraire,
  somme,
  versTexte,
  type Fraction,
} from "./fraction";
import { TOLERANCE_TENDANCE_KPI_DEFAUT, toleranceKpi } from "./tendance";

export const FENETRE_EFFICACITE_KPI_DEFAUT = 3;
export const MINIMUM_PAR_COTE_KPI_DEFAUT = 2;
const FENETRE_MAX = 24;

export type VerdictEfficaciteKpi = "efficace" | "inefficace" | "neutre" | "indeterminee";

export interface PeriodeValeurKpi {
  readonly cle: string;
  readonly debut: DateISO;
  readonly fin: DateISO;
  readonly close: boolean;
  readonly valeur: number | null;
}

export interface SelectionAvantApresKpi {
  readonly avant: readonly PeriodeValeurKpi[];
  readonly apres: readonly PeriodeValeurKpi[];
  /** Période de la date d'effet, exclue ; null si la date tombe hors des périodes fournies. */
  readonly periodeEffet: string | null;
}

function fenetreValide(fenetre: number | undefined, defaut: number): number {
  const f = fenetre ?? defaut;
  if (!Number.isSafeInteger(f) || f < 1 || f > FENETRE_MAX) {
    throw new ErreurKpi("OPTIONS_INVALIDES", `La fenêtre est un entier de 1 à ${FENETRE_MAX}.`);
  }
  return f;
}

/** Périodes (triées par début) retenues de part et d'autre de la date d'effet. */
export function selectionnerPeriodesAvantApres(
  periodes: readonly PeriodeValeurKpi[],
  dateEffet: DateISO,
  fenetre?: number,
): SelectionAvantApresKpi {
  const n = fenetreValide(fenetre, FENETRE_EFFICACITE_KPI_DEFAUT);
  const triees = [...periodes].sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
  const exploitable = (p: PeriodeValeurKpi) => p.close && p.valeur !== null;
  const avantToutes = triees.filter((p) => p.fin < dateEffet && exploitable(p));
  const apresToutes = triees.filter((p) => p.debut >= dateEffet && exploitable(p));
  const effet = triees.find((p) => p.debut < dateEffet && p.fin >= dateEffet) ?? null;
  return {
    // Les `n` dernières périodes closes et mesurées avant la date d'effet.
    avant: avantToutes.slice(-n),
    // Les `n` premières périodes closes et mesurées à partir de la date d'effet.
    apres: apresToutes.slice(0, n),
    periodeEffet: effet?.cle ?? null,
  };
}

export interface OptionsEfficaciteKpi {
  readonly minimumParCote?: number;
  readonly toleranceRelative?: number;
  readonly toleranceAbsolue?: number;
}

export interface EfficaciteKpi {
  readonly verdict: VerdictEfficaciteKpi;
  readonly nombreAvant: number;
  readonly nombreApres: number;
  readonly moyenneAvant: number | null;
  readonly moyenneApres: number | null;
  readonly variation: number | null;
  readonly variationExacte: string | null;
  /** Variation / |moyenne avant| ; null si la moyenne avant est nulle. */
  readonly variationRelative: number | null;
  /** Variation selon le sens de lecture : positive = amélioration. */
  readonly variationOrientee: number | null;
  /** Périodes mesurées encore nécessaires de chaque côté pour conclure. */
  readonly manquantAvant: number;
  readonly manquantApres: number;
}

function moyenne(valeurs: readonly number[]): Fraction {
  return diviser(somme(valeurs.map((v) => depuisNombre(v, "Une valeur"))), entier(valeurs.length));
}

export function mesurerEfficaciteActionKpi(
  entree: {
    readonly sens: SensLectureKpi;
    readonly avant: readonly number[];
    readonly apres: readonly number[];
  },
  options: OptionsEfficaciteKpi = {},
): EfficaciteKpi {
  if (entree.sens !== "plus_haut_mieux" && entree.sens !== "plus_bas_mieux") {
    throw new ErreurKpi("OPTIONS_INVALIDES", "Le sens de lecture est inconnu.");
  }
  const minimum = options.minimumParCote ?? MINIMUM_PAR_COTE_KPI_DEFAUT;
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > FENETRE_MAX) {
    throw new ErreurKpi("OPTIONS_INVALIDES", "Le minimum par côté est un entier ≥ 1.");
  }
  const tolRel = toleranceKpi(
    options.toleranceRelative,
    TOLERANCE_TENDANCE_KPI_DEFAUT,
    "La tolérance relative",
  );
  const tolAbs = toleranceKpi(options.toleranceAbsolue, 0, "La tolérance absolue");
  const manquantAvant = Math.max(0, minimum - entree.avant.length);
  const manquantApres = Math.max(0, minimum - entree.apres.length);
  const comptes = {
    nombreAvant: entree.avant.length,
    nombreApres: entree.apres.length,
    manquantAvant,
    manquantApres,
  };
  const mAvant = entree.avant.length > 0 ? moyenne(entree.avant) : null;
  const mApres = entree.apres.length > 0 ? moyenne(entree.apres) : null;
  if (manquantAvant > 0 || manquantApres > 0 || mAvant === null || mApres === null) {
    return {
      verdict: "indeterminee",
      moyenneAvant: mAvant === null ? null : arrondir(mAvant),
      moyenneApres: mApres === null ? null : arrondir(mApres),
      variation: null,
      variationExacte: null,
      variationRelative: null,
      variationOrientee: null,
      ...comptes,
    };
  }
  const variation = soustraire(mApres, mAvant);
  const orientee = entree.sens === "plus_haut_mieux" ? variation : oppose(variation);
  const relative = multiplier(tolRel, absolu(mAvant));
  const tolerance = comparer(relative, tolAbs) >= 0 ? relative : tolAbs;
  const verdict: VerdictEfficaciteKpi =
    comparer(absolu(orientee), tolerance) <= 0
      ? "neutre"
      : comparer(orientee, ZERO) > 0
        ? "efficace"
        : "inefficace";
  return {
    verdict,
    moyenneAvant: arrondir(mAvant),
    moyenneApres: arrondir(mApres),
    variation: arrondir(variation),
    variationExacte: versTexte(variation),
    variationRelative: estNul(mAvant) ? null : arrondir(diviser(variation, absolu(mAvant))),
    variationOrientee: arrondir(orientee),
    ...comptes,
  };
}
