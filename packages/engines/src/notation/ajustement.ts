/**
 * Ajustement motivé et tracé du score (NOT-04).
 *
 * Le consultant corrige le score d'une dimension par un écart (`delta`, en
 * points sur 100, 1 décimale au plus) fondé sur ses notes terrain ou ses
 * entretiens. Règles :
 * - motif et auteur obligatoires, date ISO valide, dates non décroissantes
 *   d'un ajustement au suivant ;
 * - seule une dimension notable s'ajuste (une dimension sans données ne se
 *   note pas par ajustement) ;
 * - score ajusté = calculé + somme des écarts, plafonné à [0, 100] (le
 *   plafonnement porte sur le cumul : l'ordre des ajustements est sans effet
 *   sur le score final) ;
 * - le score global ajusté se recalcule avec les poids et la stratégie du
 *   calcul initial, sur les scores exacts ;
 * - le résultat calculé initial est conservé tel quel (copie figée) et
 *   l'historique est immuable : chaque appel rend un nouvel objet figé.
 */
import { analyserDateISO, type DateISO } from "../commun/dates";
import { classe as classeDe, type Classe } from "./classes";
import { ErreurNotation } from "./erreurs";
import {
  CENT,
  ZERO,
  ajouter,
  arrondir,
  borner,
  comparer,
  depuisNombre,
  depuisTexte,
  diviser,
  estNul,
  multiplier,
  somme,
  type Fraction,
} from "./fraction";
import type { ResultatNotation } from "./score";

export interface Ajustement {
  readonly dimension: string;
  readonly delta: number;
  readonly motif: string;
  readonly auteur: string;
  readonly date: DateISO;
}

export interface AjustementTrace extends Ajustement {
  /** Rang dans l'historique (1, 2, …). */
  readonly rang: number;
  /** Score ajusté de la dimension avant et après cet ajustement. */
  readonly scoreAvant: number;
  readonly scoreApres: number;
  /** Vrai si le cumul a été plafonné à 0 ou 100. */
  readonly plafonne: boolean;
}

export interface DimensionAjustee {
  readonly dimension: string;
  readonly libelle: string;
  readonly famille: string;
  readonly scoreCalcule: number | null;
  readonly score: number | null;
  readonly classe: Classe | null;
  /** Somme des écarts appliqués (avant plafonnement). */
  readonly deltaCumule: number;
}

export interface ScoreAjuste {
  /** Résultat calculé initial, intact. */
  readonly calcule: ResultatNotation;
  readonly ajustements: readonly AjustementTrace[];
  readonly dimensions: readonly DimensionAjustee[];
  readonly notable: boolean;
  readonly scoreCalcule: number | null;
  readonly score: number | null;
  readonly classe: Classe | null;
}

function figerProfond<T>(valeur: T): T {
  if (valeur !== null && typeof valeur === "object") {
    Object.values(valeur).forEach(figerProfond);
    Object.freeze(valeur);
  }
  return valeur;
}

function copieFigee<T>(valeur: T): T {
  return figerProfond(JSON.parse(JSON.stringify(valeur)) as T);
}

function refus(message: string): never {
  throw new ErreurNotation("AJUSTEMENT_INVALIDE", message);
}

function verifierAjustement(a: Ajustement, precedent: AjustementTrace | undefined): void {
  if (a.motif.trim() === "") refus("Le motif de l'ajustement est obligatoire.");
  if (a.auteur.trim() === "") refus("L'auteur de l'ajustement est obligatoire.");
  if (!analyserDateISO(a.date).valide) refus(`Date d'ajustement invalide : « ${a.date} ».`);
  if (precedent !== undefined && a.date < precedent.date) {
    refus("Un ajustement ne peut pas être antérieur au précédent.");
  }
  if (!Number.isFinite(a.delta) || a.delta === 0 || Math.abs(a.delta) > 100) {
    refus("L'écart doit être non nul et compris entre −100 et 100.");
  }
  if (10n % depuisNombre(a.delta).den !== 0n) {
    refus("L'écart s'exprime avec une décimale au plus.");
  }
}

/** Recalcule dimensions et global ajustés à partir du calcul initial et de l'historique. */
function recalculer(
  calcule: ResultatNotation,
  ajustements: readonly AjustementTrace[],
): ScoreAjuste {
  const cumuls = new Map<string, Fraction>();
  for (const a of ajustements) {
    cumuls.set(a.dimension, ajouter(cumuls.get(a.dimension) ?? ZERO, depuisNombre(a.delta)));
  }
  const exacts = calcule.dimensions.map((d) => {
    const base = d.scoreExact === null ? null : depuisTexte(d.scoreExact);
    const cumul = cumuls.get(d.dimension) ?? ZERO;
    return { d, cumul, exact: base === null ? null : borner(ajouter(base, cumul), ZERO, CENT) };
  });
  const notables = exacts.filter((e) => e.exact !== null && !estNul(depuisTexte(e.d.poidsExact)));
  const poidsNotable = somme(notables.map((e) => depuisTexte(e.d.poidsExact)));
  const denominateur = calcule.strategie === "penaliser" ? CENT : poidsNotable;
  const global = calcule.notable
    ? diviser(
        somme(notables.map((e) => multiplier(depuisTexte(e.d.poidsExact), e.exact as Fraction))),
        denominateur,
      )
    : null;
  const score = global === null ? null : arrondir(global);
  return figerProfond({
    calcule,
    ajustements,
    notable: calcule.notable,
    scoreCalcule: calcule.score,
    score,
    classe: score === null ? null : classeDe(score),
    dimensions: exacts.map((e) => {
      const s = e.exact === null ? null : arrondir(e.exact);
      return {
        dimension: e.d.dimension,
        libelle: e.d.libelle,
        famille: e.d.famille,
        scoreCalcule: e.d.score,
        score: s,
        classe: s === null ? null : classeDe(s),
        deltaCumule: arrondir(e.cumul),
      };
    }),
  });
}

/** Point de départ d'un historique d'ajustements : aucun ajustement, scores = calculés. */
export function initialiserAjustements(calcule: ResultatNotation): ScoreAjuste {
  return recalculer(copieFigee(calcule), Object.freeze([]));
}

function estScoreAjuste(s: ResultatNotation | ScoreAjuste): s is ScoreAjuste {
  return "calcule" in s;
}

/**
 * Applique un ajustement motivé à une dimension et rend un NOUVEL état figé :
 * historique complété, score de la dimension et score global recalculés.
 * Accepte un résultat calculé (premier ajustement) ou un état déjà ajusté.
 */
export function appliquerAjustement(
  score: ResultatNotation | ScoreAjuste,
  ajustement: Ajustement,
): ScoreAjuste {
  const etat = estScoreAjuste(score) ? score : initialiserAjustements(score);
  const precedent = etat.ajustements[etat.ajustements.length - 1];
  verifierAjustement(ajustement, precedent);
  const dimension = etat.dimensions.find((d) => d.dimension === ajustement.dimension);
  if (dimension === undefined) {
    throw new ErreurNotation(
      "DIMENSION_INCONNUE",
      `Dimension inconnue : « ${ajustement.dimension} ».`,
    );
  }
  const base = etat.calcule.dimensions.find(
    (d) => d.dimension === ajustement.dimension,
  )?.scoreExact;
  if (base === null || base === undefined) {
    throw new ErreurNotation(
      "DIMENSION_NON_NOTABLE",
      `La dimension « ${ajustement.dimension} » n'est pas notable : elle ne peut pas être ajustée.`,
    );
  }
  const cumulAvant = depuisNombre(dimension.deltaCumule);
  const cumulApres = ajouter(cumulAvant, depuisNombre(ajustement.delta));
  const brut = ajouter(depuisTexte(base), cumulApres);
  const trace: AjustementTrace = {
    dimension: ajustement.dimension,
    delta: ajustement.delta,
    motif: ajustement.motif.trim(),
    auteur: ajustement.auteur,
    date: ajustement.date,
    rang: etat.ajustements.length + 1,
    scoreAvant: dimension.score as number,
    scoreApres: arrondir(borner(brut, ZERO, CENT)),
    plafonne: comparer(brut, ZERO) < 0 || comparer(brut, CENT) > 0,
  };
  return recalculer(etat.calcule, Object.freeze([...etat.ajustements, trace]));
}
