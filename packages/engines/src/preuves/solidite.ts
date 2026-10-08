/**
 * Indice de solidité d'une assertion (PRV-02, PRD complémentaire §6).
 *
 * Formule (valeurs à calibrer au pilote) :
 * 1. pour chaque type de source indépendant (questionnaire, entretien,
 *    observation, document, donnée externe), on retient la MEILLEURE
 *    fiabilité parmi les preuves « pour » (A = 1 ; B = 0,75 ; C = 0,5 ;
 *    D = 0,25) ;
 * 2. on somme ces poids, on plafonne à 2, on divise par 2 ;
 * 3. une contradiction non résolue (preuve « contre » non arbitrée, ou
 *    contradiction enregistrée par ailleurs) divise l'indice par deux, une
 *    seule fois quel que soit le nombre de contradictions.
 *
 * Lecture : solide ≥ 0,75 (au moins deux sources indépendantes fiables),
 * étayée de 0,5 inclus à 0,75 exclu, fragile en dessous.
 *
 * Arithmétique exacte : poids en centièmes entiers, indice tenu en fraction
 * `numerateur / denominateur` d'entiers, seuils en dix-millièmes entiers
 * comparés par produits croisés ; `indice` n'est arrondi à 4 décimales qu'en
 * sortie (`arrondirRatio`).
 */
import { arrondirRatio } from "../commun/ratio";
import { regrouperPreuvesAssertion } from "./contradictions";
import { ErreurPreuves } from "./erreurs";
import {
  FIABILITES_PREUVE,
  POIDS_FIABILITE_CENTIEMES,
  rangFiabilite,
  TYPES_SOURCE_PREUVE,
  type FiabilitePreuve,
  type PreuveAssertion,
  type TypeSourcePreuve,
} from "./preuve";

export type LectureSolidite = "solide" | "etayee" | "fragile";

/** Plafond de la somme des poids, en centièmes (2 dans la formule du PRD). */
export const PLAFOND_SOLIDITE_CENTIEMES = 200;

/** Seuils de lecture en dix-millièmes de l'indice (0,75 et 0,5). */
export const SEUILS_SOLIDITE_DEFAUT = { solide: 7_500, etayee: 5_000 } as const;

const DIX_MILLE = 10_000;

export interface SeuilsSolidite {
  /** Indice minimal d'une assertion solide, en dix-millièmes (inclus). */
  readonly solide: number;
  /** Indice minimal d'une assertion étayée, en dix-millièmes (inclus). */
  readonly etayee: number;
}

export interface OptionsSolidite {
  /** Poids de chaque fiabilité en centièmes entiers de 0 à 100 (calibration). */
  readonly poidsCentiemes?: Readonly<Record<FiabilitePreuve, number>>;
  /** Plafond de la somme en centièmes, entier strictement positif (défaut 200). */
  readonly plafondCentiemes?: number;
  readonly seuils?: SeuilsSolidite;
}

export interface EntreeSolidite {
  readonly preuves: readonly PreuveAssertion[];
  /** Contradictions non résolues enregistrées hors des preuves « contre » (PRV-04). */
  readonly contradictionsNonResolues?: number;
}

export interface FiabiliteRetenue {
  readonly typeSource: TypeSourcePreuve;
  readonly fiabilite: FiabilitePreuve;
  readonly poidsCentiemes: number;
}

export interface SoliditeAssertion {
  /** Indice de 0 à 1, arrondi à 4 décimales. */
  readonly indice: number;
  /** Indice exact : numerateur / denominateur. */
  readonly numerateur: number;
  readonly denominateur: number;
  readonly lecture: LectureSolidite;
  /** Meilleure fiabilité « pour » de chaque type de source, dans l'ordre canonique des types. */
  readonly fiabilitesRetenues: readonly FiabiliteRetenue[];
  /** Somme des poids retenus avant plafond, en centièmes. */
  readonly sommeCentiemes: number;
  readonly plafonnee: boolean;
  readonly contradictionNonResolue: boolean;
  readonly preuvesPour: number;
  readonly preuvesContre: number;
}

function entierDans(valeur: unknown, min: number, max: number): valeur is number {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= min && valeur <= max;
}

function optionsValidees(options: OptionsSolidite): {
  poids: Readonly<Record<FiabilitePreuve, number>>;
  plafond: number;
  seuils: SeuilsSolidite;
} {
  const poids = options.poidsCentiemes ?? POIDS_FIABILITE_CENTIEMES;
  const plafond = options.plafondCentiemes ?? PLAFOND_SOLIDITE_CENTIEMES;
  const seuils = options.seuils ?? SEUILS_SOLIDITE_DEFAUT;
  if (!FIABILITES_PREUVE.every((f) => entierDans(poids[f], 0, 100))) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Poids de fiabilité : entiers de 0 à 100.");
  }
  if (!entierDans(plafond, 1, 100 * TYPES_SOURCE_PREUVE.length)) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Plafond de solidité invalide.");
  }
  if (
    !entierDans(seuils.etayee, 0, DIX_MILLE) ||
    !entierDans(seuils.solide, seuils.etayee, DIX_MILLE)
  ) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Seuils de solidité invalides.");
  }
  return { poids, plafond, seuils };
}

/** Lecture d'un indice exact `numerateur / denominateur` selon les seuils (dix-millièmes). */
export function lectureSolidite(
  numerateur: number,
  denominateur: number,
  seuils: SeuilsSolidite = SEUILS_SOLIDITE_DEFAUT,
): LectureSolidite {
  if (
    !entierDans(numerateur, 0, Number.MAX_SAFE_INTEGER) ||
    !entierDans(denominateur, 1, Number.MAX_SAFE_INTEGER)
  ) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Indice de solidité invalide.");
  }
  const echelle = numerateur * DIX_MILLE;
  if (echelle >= seuils.solide * denominateur) return "solide";
  if (echelle >= seuils.etayee * denominateur) return "etayee";
  return "fragile";
}

/** Meilleure fiabilité « pour » par type de source, dans l'ordre canonique des types. */
function meilleuresFiabilites(
  pour: readonly PreuveAssertion[],
  poids: Readonly<Record<FiabilitePreuve, number>>,
): FiabiliteRetenue[] {
  const meilleure = new Map<TypeSourcePreuve, FiabilitePreuve>();
  for (const p of pour) {
    const actuelle = meilleure.get(p.typeSource);
    if (actuelle === undefined || rangFiabilite(p.fiabilite) < rangFiabilite(actuelle)) {
      meilleure.set(p.typeSource, p.fiabilite);
    }
  }
  return TYPES_SOURCE_PREUVE.filter((t) => meilleure.has(t)).map((typeSource) => {
    const fiabilite = meilleure.get(typeSource)!;
    return { typeSource, fiabilite, poidsCentiemes: poids[fiabilite] };
  });
}

/** Indice de solidité d'une assertion à partir de ses preuves pour et contre. */
export function indiceSolidite(
  entree: EntreeSolidite,
  options: OptionsSolidite = {},
): SoliditeAssertion {
  const { poids, plafond, seuils } = optionsValidees(options);
  const externes = entree.contradictionsNonResolues ?? 0;
  if (!entierDans(externes, 0, Number.MAX_SAFE_INTEGER)) {
    throw new ErreurPreuves("ASSERTION_INVALIDE", "Nombre de contradictions invalide.");
  }
  const groupes = regrouperPreuvesAssertion(entree.preuves);
  const fiabilitesRetenues = meilleuresFiabilites(groupes.pour, poids);
  const sommeCentiemes = fiabilitesRetenues.reduce((s, f) => s + f.poidsCentiemes, 0);
  const contradictionNonResolue = groupes.contradictionNonResolue || externes > 0;
  const numerateur = Math.min(sommeCentiemes, plafond);
  const denominateur = plafond * (contradictionNonResolue ? 2 : 1);
  return {
    indice: arrondirRatio(numerateur / denominateur),
    numerateur,
    denominateur,
    lecture: lectureSolidite(numerateur, denominateur, seuils),
    fiabilitesRetenues,
    sommeCentiemes,
    plafonnee: sommeCentiemes > plafond,
    contradictionNonResolue,
    preuvesPour: groupes.pour.length,
    preuvesContre: groupes.contre.length,
  };
}
