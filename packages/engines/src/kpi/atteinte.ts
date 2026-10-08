/**
 * Taux d'atteinte d'une cible, écart et statut vert/orange/rouge (KPI-03).
 *
 * Règle validée (docs/DECISIONS.md, KPI-03) : vert si l'atteinte est ≥ 95 %
 * de la cible, orange de 80 % (inclus) à 95 % (exclu), rouge sous 80 % ; le
 * sens de lecture est propre à chaque KPI. Seuils paramétrables.
 *
 * Taux d'atteinte, linéaire et symétrique, défini pour toute cible non nulle :
 * - plus haut = mieux : 1 + (valeur − cible) / |cible|   (= valeur / cible si cible > 0)
 * - plus bas = mieux  : 1 − (valeur − cible) / |cible|   (= 2 − valeur / cible si cible > 0)
 * Ainsi 95 % signifie toujours « à 5 % de la cible du mauvais côté », que la
 * cible soit positive ou négative (perte maximale, solde) et quelle que soit
 * la valeur (nulle ou négative). Le taux peut être négatif ou dépasser 100 %.
 *
 * Cible nulle (« zéro accident ») : l'écart relatif n'existe pas. Le taux est
 * binaire : 1 si la cible est respectée (valeur ≥ 0 en « plus haut », ≤ 0 en
 * « plus bas »), 0 sinon ; donc vert ou rouge, jamais orange.
 *
 * Plafond et plancher (facultatifs) bornent le taux affiché et agrégé
 * (plafond ≥ 1, plancher ≤ 0) ; le statut se calcule toujours sur le taux non
 * borné, exact.
 */
import { ErreurKpi } from "./erreurs";
import {
  UN,
  ZERO,
  absolu,
  ajouter,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  oppose,
  soustraire,
  versTexte,
  type Fraction,
} from "./fraction";

export type SensLectureKpi = "plus_haut_mieux" | "plus_bas_mieux";

/** Statut d'un KPI ; « non_mesure » sans valeur, « sans_cible » sans cible. */
export type StatutKpi = "vert" | "orange" | "rouge" | "non_mesure" | "sans_cible";

export type StatutKpiMesure = "vert" | "orange" | "rouge";

/** Seuils d'atteinte en fraction de la cible (0,95 = 95 %). */
export interface SeuilsStatutKpi {
  readonly vert: number;
  readonly orange: number;
}

export const SEUILS_STATUT_KPI_DEFAUT: SeuilsStatutKpi = { vert: 0.95, orange: 0.8 };

export interface OptionsAtteinteKpi {
  /** Taux maximal retenu (≥ 1) ; `null` ou absent : dépassement non plafonné. */
  readonly plafond?: number | null;
  /** Taux minimal retenu (≤ 0) ; `null` ou absent : pas de plancher. */
  readonly plancher?: number | null;
}

export interface AtteinteKpi {
  /** Taux borné, arrondi à 4 décimales (0,95 = 95 %). */
  readonly taux: number;
  /** Taux borné exact « num/den ». */
  readonly tauxExact: string;
  /** Taux non borné exact, base du statut. */
  readonly tauxBrutExact: string;
  readonly mode: "relatif" | "binaire";
  readonly borne: "plafond" | "plancher" | null;
}

/** Seuils exacts validés : 0 ≤ orange < vert ≤ 1. */
export interface SeuilsExacts {
  readonly vert: Fraction;
  readonly orange: Fraction;
}

export function seuilsExacts(seuils: SeuilsStatutKpi = SEUILS_STATUT_KPI_DEFAUT): SeuilsExacts {
  const vert = depuisNombre(seuils.vert, "Le seuil vert");
  const orange = depuisNombre(seuils.orange, "Le seuil orange");
  if (comparer(orange, ZERO) < 0 || comparer(orange, vert) >= 0 || comparer(vert, UN) > 0) {
    throw new ErreurKpi(
      "SEUILS_INVALIDES",
      "Les seuils doivent vérifier 0 ≤ orange < vert ≤ 1 (fractions de la cible).",
    );
  }
  return { vert, orange };
}

interface BornesExactes {
  readonly plafond: Fraction | null;
  readonly plancher: Fraction | null;
}

export function bornesExactes(options: OptionsAtteinteKpi = {}): BornesExactes {
  const plafond = options.plafond == null ? null : depuisNombre(options.plafond, "Le plafond");
  const plancher = options.plancher == null ? null : depuisNombre(options.plancher, "Le plancher");
  if (plafond !== null && comparer(plafond, UN) < 0) {
    throw new ErreurKpi("BORNES_INVALIDES", "Le plafond d'atteinte doit être au moins 1 (100 %).");
  }
  if (plancher !== null && comparer(plancher, ZERO) > 0) {
    throw new ErreurKpi("BORNES_INVALIDES", "Le plancher d'atteinte doit être au plus 0.");
  }
  return { plafond, plancher };
}

/** Taux exact non borné et son mode de calcul. */
export function tauxBrut(
  valeur: Fraction,
  cible: Fraction,
  sens: SensLectureKpi,
): { readonly taux: Fraction; readonly mode: "relatif" | "binaire" } {
  const ecart = soustraire(valeur, cible);
  const oriente = sens === "plus_haut_mieux" ? ecart : oppose(ecart);
  if (estNul(cible)) {
    return { taux: comparer(oriente, ZERO) >= 0 ? UN : ZERO, mode: "binaire" };
  }
  return { taux: ajouter(UN, diviser(oriente, absolu(cible))), mode: "relatif" };
}

export function borner(
  taux: Fraction,
  bornes: BornesExactes,
): { readonly taux: Fraction; readonly borne: "plafond" | "plancher" | null } {
  if (bornes.plafond !== null && comparer(taux, bornes.plafond) > 0) {
    return { taux: bornes.plafond, borne: "plafond" };
  }
  if (bornes.plancher !== null && comparer(taux, bornes.plancher) < 0) {
    return { taux: bornes.plancher, borne: "plancher" };
  }
  return { taux, borne: null };
}

export function construireAtteinte(
  valeur: Fraction,
  cible: Fraction,
  sens: SensLectureKpi,
  bornes: BornesExactes,
): { readonly atteinte: AtteinteKpi; readonly brut: Fraction; readonly borne: Fraction } {
  const brut = tauxBrut(valeur, cible, sens);
  const borne = borner(brut.taux, bornes);
  const atteinte: AtteinteKpi = {
    taux: arrondir(borne.taux),
    tauxExact: versTexte(borne.taux),
    tauxBrutExact: versTexte(brut.taux),
    mode: brut.mode,
    borne: borne.borne,
  };
  return { atteinte, brut: brut.taux, borne: borne.taux };
}

/** Taux d'atteinte de `cible` par `valeur` selon le sens de lecture. */
export function tauxAtteinteKpi(
  valeur: number,
  cible: number,
  sens: SensLectureKpi,
  options: OptionsAtteinteKpi = {},
): AtteinteKpi {
  const v = depuisNombre(valeur, "La valeur");
  const c = depuisNombre(cible, "La cible");
  return construireAtteinte(v, c, sens, bornesExactes(options)).atteinte;
}

export function statutExact(taux: Fraction, seuils: SeuilsExacts): StatutKpiMesure {
  if (comparer(taux, seuils.vert) >= 0) return "vert";
  if (comparer(taux, seuils.orange) >= 0) return "orange";
  return "rouge";
}

/** Statut d'un taux d'atteinte (fraction de la cible), comparé exactement aux seuils. */
export function statutKpiDepuisTaux(
  taux: number,
  seuils: SeuilsStatutKpi = SEUILS_STATUT_KPI_DEFAUT,
): StatutKpiMesure {
  return statutExact(depuisNombre(taux, "Le taux"), seuilsExacts(seuils));
}

const RANGS: Readonly<Record<StatutKpiMesure, number>> = { rouge: 0, orange: 1, vert: 2 };

/** Rang d'un statut mesuré pour comparer deux statuts : rouge 0 < orange 1 < vert 2. */
export function rangStatutKpi(statut: StatutKpiMesure): number {
  return RANGS[statut];
}

export interface EcartCibleKpi {
  /** valeur − cible, arrondi à 4 décimales. */
  readonly ecart: number;
  readonly ecartExact: string;
  /** (valeur − cible) / |cible|, 4 décimales ; `null` si la cible est nulle. */
  readonly ecartRelatif: number | null;
  /** Écart dans le sens favorable : positif = mieux que la cible. */
  readonly ecartOriente: number;
  /** La cible est atteinte ou dépassée dans le bon sens. */
  readonly cibleAtteinte: boolean;
}

/** Écart d'une valeur à sa cible, brut, relatif et orienté par le sens de lecture. */
export function ecartCibleKpi(valeur: number, cible: number, sens: SensLectureKpi): EcartCibleKpi {
  const c = depuisNombre(cible, "La cible");
  const ecart = soustraire(depuisNombre(valeur, "La valeur"), c);
  const oriente = sens === "plus_haut_mieux" ? ecart : oppose(ecart);
  return {
    ecart: arrondir(ecart),
    ecartExact: versTexte(ecart),
    ecartRelatif: estNul(c) ? null : arrondir(diviser(ecart, absolu(c))),
    ecartOriente: arrondir(oriente),
    cibleAtteinte: comparer(oriente, ZERO) >= 0,
  };
}

export interface OptionsEvaluationKpi extends OptionsAtteinteKpi {
  readonly seuils?: SeuilsStatutKpi;
}

export interface EntreeEvaluationKpi {
  readonly valeur: number | null | undefined;
  readonly cible: number | null | undefined;
  readonly sens: SensLectureKpi;
}

export interface EvaluationKpi {
  readonly statut: StatutKpi;
  readonly atteinte: AtteinteKpi | null;
  readonly ecart: EcartCibleKpi | null;
}

/**
 * Évalue un KPI : statut, atteinte et écart. Sans valeur : « non_mesure » ;
 * avec une valeur mais sans cible : « sans_cible ». Les seuils et bornes sont
 * validés dans tous les cas, pour qu'une configuration fausse ne passe pas
 * inaperçue tant que le KPI n'est pas mesuré.
 */
export function evaluerKpi(
  entree: EntreeEvaluationKpi,
  options: OptionsEvaluationKpi = {},
): EvaluationKpi {
  const seuils = seuilsExacts(options.seuils);
  const bornes = bornesExactes(options);
  if (entree.valeur == null) return { statut: "non_mesure", atteinte: null, ecart: null };
  if (entree.cible == null) return { statut: "sans_cible", atteinte: null, ecart: null };
  const valeur = depuisNombre(entree.valeur, "La valeur");
  const cible = depuisNombre(entree.cible, "La cible");
  const { atteinte, brut } = construireAtteinte(valeur, cible, entree.sens, bornes);
  return {
    statut: statutExact(brut, seuils),
    atteinte,
    ecart: ecartCibleKpi(entree.valeur, entree.cible, entree.sens),
  };
}
