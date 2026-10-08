/**
 * Arbres d'indicateurs (KPI-13) : décomposition d'un KPI en leviers et
 * contribution de chaque levier à la variation du KPI entre deux situations
 * (« avant » et « après »).
 *
 * Chaque nœud combine ses enfants par une relation :
 * - « somme »   : valeur = Σ coefficient × valeur de l'enfant (le coefficient
 *   peut être négatif : un coût se retranche d'une marge) ;
 * - « produit » : valeur = Π valeur de l'enfant (coefficients tous égaux à 1).
 * Un nœud sans enfant est un levier : sa valeur est observée (mesure d'un KPI).
 * Un nœud avec enfants prend la valeur CALCULÉE de ses enfants ; la valeur
 * observée de ce nœud, si elle existe, ne sert qu'à mesurer le résidu (la part
 * que l'arbre n'explique pas).
 *
 * Contribution d'un enfant à la variation de son parent (arithmétique exacte) :
 * - somme   : coefficient × (après − avant) ; la somme des contributions est
 *   exactement la variation du parent ;
 * - produit : substitution en chaîne dans l'ordre des rangs (les facteurs
 *   passent un à un de « avant » à « après ») ; la somme des contributions est
 *   exactement la variation du produit. Cette méthode dépend de l'ordre des
 *   rangs : il est donc explicite et figé par l'appelant.
 * La contribution à la RACINE se propage le long du chemin au prorata de la
 * part de chaque nœud dans la variation de son parent ; la somme des
 * contributions à la racine des leviers est exactement la variation calculée
 * de la racine. Résultats arrondis à 4 décimales ; les contributions à la
 * racine sont aussi rendues en fraction exacte (trace).
 *
 * Fonctions pures, déterministes ; aucun LLM. Bornes : MAX_NOEUDS_ARBRE_KPI
 * nœuds, MAX_PROFONDEUR_ARBRE_KPI niveaux sous la racine.
 */
import type { SensLectureKpi } from "./atteinte";
import { ErreurKpi } from "./erreurs";
import {
  UN,
  ZERO,
  absolu,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  multiplier,
  somme,
  soustraire,
  versTexte,
  type Fraction,
} from "./fraction";

export const MAX_NOEUDS_ARBRE_KPI = 50;
export const MAX_PROFONDEUR_ARBRE_KPI = 6;

export type RelationArbreKpi = "somme" | "produit";

export interface NoeudArbreKpi {
  readonly id: string;
  /** null : la racine (une seule). */
  readonly parentId: string | null;
  /** Façon dont les enfants de ce nœud se combinent (sans effet sur une feuille). */
  readonly relation: RelationArbreKpi;
  /** Poids de ce nœud dans la somme de son parent (1 sous un produit). */
  readonly coefficient: number;
  /** Ordre parmi les frères : fixe l'ordre de la substitution d'un produit. */
  readonly rang: number;
  /** Valeur observée avant / après (null : non mesurée). */
  readonly avant: number | null;
  readonly apres: number | null;
}

export interface OptionsArbreKpi {
  /** Sens de lecture du KPI racine : détermine les leviers favorables. */
  readonly sens: SensLectureKpi;
}

export interface NoeudResultatKpi {
  readonly id: string;
  readonly parentId: string | null;
  readonly profondeur: number;
  readonly feuille: boolean;
  /** Valeur avant/après : calculée si le nœud a des enfants, observée sinon ; null si inconnue. */
  readonly avant: number | null;
  readonly apres: number | null;
  readonly variation: number | null;
  /** Observée moins calculée (nœud interne mesuré) : part non expliquée par l'arbre. */
  readonly residuAvant: number | null;
  readonly residuApres: number | null;
  /** Contribution à la variation du parent (null pour la racine ou si non évaluable). */
  readonly contributionParent: number | null;
  /** Part de la variation du parent (null si elle est nulle ou non évaluable). */
  readonly partParent: number | null;
  /** Contribution à la variation de la racine. */
  readonly contributionRacine: number | null;
  readonly contributionRacineExacte: string | null;
  readonly partRacine: number | null;
  readonly evaluable: boolean;
}

export interface LevierKpi {
  readonly id: string;
  readonly contributionRacine: number;
  readonly partRacine: number | null;
  /** Vrai si la contribution va dans le bon sens pour le KPI racine ; null si elle est nulle. */
  readonly favorable: boolean | null;
  /** 1 = levier de plus forte contribution absolue. */
  readonly rang: number;
}

export interface ResultatArbreKpi {
  readonly racineId: string;
  /** Vrai si tous les leviers ont une valeur avant et après. */
  readonly evaluable: boolean;
  /** Leviers sans valeur avant ou après. */
  readonly manquants: readonly string[];
  readonly variationRacine: number | null;
  readonly noeuds: readonly NoeudResultatKpi[];
  /** Feuilles par contribution absolue décroissante (égalité : ordre d'entrée). */
  readonly leviers: readonly LevierKpi[];
}

interface Interne {
  noeud: NoeudArbreKpi;
  enfants: Interne[];
  profondeur: number;
  coef: Fraction;
  avant: Fraction | null;
  apres: Fraction | null;
  contributionParent: Fraction | null;
  racine: Fraction | null;
  residuAvant: Fraction | null;
  residuApres: Fraction | null;
}

function invalide(message: string): never {
  throw new ErreurKpi("ARBRE_INVALIDE", message);
}

function construire(noeuds: readonly NoeudArbreKpi[]): Interne {
  if (noeuds.length === 0) invalide("L'arbre est vide.");
  if (noeuds.length > MAX_NOEUDS_ARBRE_KPI) {
    invalide(`Un arbre compte au plus ${MAX_NOEUDS_ARBRE_KPI} nœuds.`);
  }
  const parId = new Map<string, Interne>();
  for (const n of noeuds) {
    if (parId.has(n.id)) invalide(`Le nœud ${n.id} est en double.`);
    if (!Number.isSafeInteger(n.rang)) invalide(`Le rang du nœud ${n.id} doit être un entier.`);
    const coef = depuisNombre(n.coefficient, `Le coefficient du nœud ${n.id}`);
    parId.set(n.id, {
      noeud: n,
      enfants: [],
      profondeur: 0,
      coef,
      avant: n.avant === null ? null : depuisNombre(n.avant, `La valeur avant de ${n.id}`),
      apres: n.apres === null ? null : depuisNombre(n.apres, `La valeur après de ${n.id}`),
      contributionParent: null,
      racine: null,
      residuAvant: null,
      residuApres: null,
    });
  }
  const racines = noeuds.filter((n) => n.parentId === null);
  if (racines.length !== 1) invalide("Un arbre a exactement une racine.");
  for (const n of noeuds) {
    if (n.parentId === null) continue;
    const parent = parId.get(n.parentId);
    if (!parent) invalide(`Le parent du nœud ${n.id} est inconnu.`);
    if (n.parentId === n.id) invalide(`Le nœud ${n.id} est son propre parent.`);
    parent.enfants.push(parId.get(n.id) as Interne);
  }
  const racine = parId.get((racines[0] as NoeudArbreKpi).id) as Interne;
  // Parcours depuis la racine : tout nœud non atteint fait partie d'un cycle isolé.
  let vus = 0;
  const pile: Interne[] = [racine];
  while (pile.length > 0) {
    const n = pile.pop() as Interne;
    vus += 1;
    if (n.profondeur > MAX_PROFONDEUR_ARBRE_KPI) {
      invalide(`Un arbre compte au plus ${MAX_PROFONDEUR_ARBRE_KPI} niveaux sous la racine.`);
    }
    n.enfants.sort((a, b) =>
      a.noeud.rang !== b.noeud.rang
        ? a.noeud.rang - b.noeud.rang
        : a.noeud.id < b.noeud.id
          ? -1
          : 1,
    );
    for (const e of n.enfants) {
      e.profondeur = n.profondeur + 1;
      if (n.noeud.relation === "produit" && comparer(e.coef, UN) !== 0) {
        invalide(`Sous un produit, le coefficient de ${e.noeud.id} est 1.`);
      }
      pile.push(e);
    }
  }
  if (vus !== noeuds.length) invalide("L'arbre contient un cycle ou des nœuds isolés.");
  return racine;
}

function calculer(n: Interne, quand: "avant" | "apres"): Fraction | null {
  if (n.enfants.length === 0) return n[quand];
  const valeurs: Fraction[] = [];
  for (const e of n.enfants) {
    const v = calculer(e, quand);
    if (v === null) return null;
    valeurs.push(n.noeud.relation === "produit" ? v : multiplier(e.coef, v));
  }
  return n.noeud.relation === "produit"
    ? valeurs.reduce((p, v) => multiplier(p, v), UN)
    : somme(valeurs);
}

/** Valeurs avant/après de chaque nœud interne, remplacées par le calcul des enfants. */
function propager(n: Interne): void {
  for (const e of n.enfants) propager(e);
  if (n.enfants.length === 0) return;
  const observeAvant = n.avant;
  const observeApres = n.apres;
  n.avant = calculer(n, "avant");
  n.apres = calculer(n, "apres");
  n.residuAvant =
    observeAvant !== null && n.avant !== null ? soustraire(observeAvant, n.avant) : null;
  n.residuApres =
    observeApres !== null && n.apres !== null ? soustraire(observeApres, n.apres) : null;
}

function repartir(n: Interne): void {
  if (n.enfants.length === 0 || n.avant === null || n.apres === null) return;
  const delta = soustraire(n.apres, n.avant);
  if (n.noeud.relation === "somme") {
    for (const e of n.enfants) {
      const ea = e.avant as Fraction;
      const ep = e.apres as Fraction;
      e.contributionParent = multiplier(e.coef, soustraire(ep, ea));
    }
  } else {
    // Substitution en chaîne : P_i remplace les i premiers facteurs « avant » par « après ».
    let precedent = n.enfants.reduce((p, e) => multiplier(p, e.avant as Fraction), UN);
    n.enfants.forEach((e, i) => {
      const courant = n.enfants.reduce(
        (p, f, j) => multiplier(p, (j <= i ? f.apres : f.avant) as Fraction),
        UN,
      );
      e.contributionParent = soustraire(courant, precedent);
      precedent = courant;
    });
  }
  for (const e of n.enfants) {
    const c = e.contributionParent as Fraction;
    // Enfant direct de la racine : sa contribution est la sienne. Plus bas : au prorata de la part
    // du nœud dans la variation de son parent (0 si cette variation est nulle : les leviers
    // du nœud se compensent et leur contribution nette à la racine est nulle).
    e.racine =
      n.noeud.parentId === null
        ? c
        : n.racine === null || estNul(delta)
          ? ZERO
          : multiplier(c, diviser(n.racine, delta));
    repartir(e);
  }
}

function aplatir(n: Interne, sortie: Interne[] = []): Interne[] {
  sortie.push(n);
  for (const e of n.enfants) aplatir(e, sortie);
  return sortie;
}

const arrondi = (f: Fraction | null) => (f === null ? null : arrondir(f, 4));

/**
 * Décompose la variation du KPI racine entre « avant » et « après » sur ses
 * leviers. Lève `ARBRE_INVALIDE` pour un arbre incohérent (racine multiple,
 * cycle, parent inconnu, trop grand, coefficient ≠ 1 sous un produit).
 */
export function decomposerArbreKpi(
  noeuds: readonly NoeudArbreKpi[],
  options: OptionsArbreKpi,
): ResultatArbreKpi {
  if (options.sens !== "plus_haut_mieux" && options.sens !== "plus_bas_mieux") {
    throw new ErreurKpi("OPTIONS_INVALIDES", "Le sens de lecture est inconnu.");
  }
  const racine = construire(noeuds);
  propager(racine);
  const variation =
    racine.avant !== null && racine.apres !== null ? soustraire(racine.apres, racine.avant) : null;
  if (variation !== null && racine.enfants.length > 0) {
    // La racine « porte » toute sa variation : ses enfants se partagent exactement cette valeur.
    racine.racine = variation;
  }
  const evaluable = variation !== null;
  if (evaluable) repartir(racine);
  const tous = aplatir(racine);
  const feuilles = tous.filter((n) => n.enfants.length === 0);
  const manquants = feuilles
    .filter((n) => n.avant === null || n.apres === null)
    .map((n) => n.noeud.id);
  const sensPositif = options.sens === "plus_haut_mieux";

  const resultat = tous.map((n): NoeudResultatKpi => {
    const parent =
      n.noeud.parentId === null ? null : tous.find((x) => x.noeud.id === n.noeud.parentId);
    const deltaParent =
      parent && parent.avant !== null && parent.apres !== null
        ? soustraire(parent.apres, parent.avant)
        : null;
    const delta = n.avant !== null && n.apres !== null ? soustraire(n.apres, n.avant) : null;
    const contribution = n.contributionParent;
    const partParent =
      contribution !== null && deltaParent !== null && !estNul(deltaParent)
        ? diviser(contribution, deltaParent)
        : null;
    const partRacine =
      n.racine !== null && variation !== null && !estNul(variation)
        ? diviser(n.racine, variation)
        : null;
    return {
      id: n.noeud.id,
      parentId: n.noeud.parentId,
      profondeur: n.profondeur,
      feuille: n.enfants.length === 0,
      avant: arrondi(n.avant),
      apres: arrondi(n.apres),
      variation: arrondi(delta),
      residuAvant: arrondi(n.residuAvant),
      residuApres: arrondi(n.residuApres),
      contributionParent: arrondi(contribution),
      partParent: arrondi(partParent),
      contributionRacine: n.noeud.parentId === null ? null : arrondi(n.racine),
      contributionRacineExacte:
        n.noeud.parentId === null || n.racine === null ? null : versTexte(n.racine),
      partRacine: n.noeud.parentId === null ? null : arrondi(partRacine),
      evaluable: n.avant !== null && n.apres !== null,
    };
  });

  const ordre = feuilles
    .filter((n) => n.noeud.parentId !== null && n.racine !== null)
    .map((n, index) => ({ n, index }))
    .sort((a, b) => {
      const c = comparer(absolu(b.n.racine as Fraction), absolu(a.n.racine as Fraction));
      return c !== 0 ? c : a.index - b.index;
    });
  const leviers = ordre.map(({ n }, i): LevierKpi => {
    const c = n.racine as Fraction;
    const signe = comparer(c, ZERO);
    return {
      id: n.noeud.id,
      contributionRacine: arrondir(c, 4),
      partRacine:
        variation !== null && !estNul(variation) ? arrondir(diviser(c, variation), 4) : null,
      favorable: signe === 0 ? null : signe > 0 === sensPositif,
      rang: i + 1,
    };
  });

  return {
    racineId: racine.noeud.id,
    evaluable,
    manquants,
    variationRacine: arrondi(variation),
    noeuds: resultat,
    leviers,
  };
}
