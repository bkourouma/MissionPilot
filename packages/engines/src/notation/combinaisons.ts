/**
 * Combinaisons minimales d'améliorations (NOT-12, PRD complémentaire §11.1) : « quel est le plus
 * petit nombre de pratiques à relever pour passer à la classe visée ? ». Complète le simulateur
 * glouton de `explication.ts` (`simulerPassage`), qui ne garantit pas ce minimum.
 *
 * Modèle (identique à celui de la simulation) : le score d'une dimension est son total brut non
 * borné (score calculé + ajustement cumulé + hausses) BORNÉ à [0, 100] ; une hausse de pratique est
 * poids × (palier − points actuels) / dénominateur de la dimension ; la contribution au score global
 * est poids de dimension / D × score de dimension. La cible est atteinte quand le score global
 * ARRONDI au dixième atteint le seuil de la classe, soit, exactement, global ≥ seuil − 0,05. Une
 * dimension dont le brut est négatif ne gagne rien tant qu'il n'est pas revenu à zéro. Tout est en
 * `Fraction` (bigint) : aucun flottant, aucune base, horloge ou IA.
 *
 * Optimalité, dans cet ordre : (1) nombre minimal k* de pratiques améliorées ; (2) nombre total
 * minimal de paliers franchis (par pratique : rang du palier cible dans `paliersAuDessus`) ;
 * (3) ordre de la grille des pratiques, puis paliers croissants. Une combinaison porte au plus un
 * palier cible par pratique et est irréductible.
 *
 * Algorithme : k* est trouvé exactement et sans énumération (tous paliers maximaux ; un
 * sac-à-dos sur les dimensions, la borne de chaque dimension étant atteinte par ses j plus fortes
 * hausses). Les combinaisons de taille k* sont ensuite énumérées en profondeur, avec élagage par
 * borne supérieure (la borne de chaque dimension est 1-lipschitzienne) et par coût, dans la limite
 * de `NOEUDS_MAX_COMBINAISONS` nœuds : au-delà, `tronquee` le dit, on ne conclut jamais à
 * l'impossibilité. Projection indicative, calculée par le moteur ; elle ne crée aucune note.
 */
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import type { ScoreAjuste } from "./ajustement";
import { BAREME_CLASSES, classe as classeDe, rangClasse, type Classe } from "./classes";
import {
  baseCalcul,
  pointsMaximaux,
  type BaseCalcul,
  type DimensionCalcul,
  type PratiqueCalcul,
} from "./explication";
import {
  CENT,
  ZERO,
  ajouter,
  arrondir,
  borner,
  comparer,
  depuisNombre,
  diviser,
  estNul,
  fraction,
  multiplier,
  soustraire,
  type Fraction,
} from "./fraction";
import type { GrilleNotation, RegleConversion } from "./grille";

/** Taille maximale d'une combinaison (nombre de pratiques améliorées). */
export const PRATIQUES_MAX_COMBINAISON = 8;
/** Nombre maximal de nœuds explorés par l'énumération. */
export const NOEUDS_MAX_COMBINAISONS = 200_000;
/** Nombre maximal de combinaisons retournées. */
export const COMBINAISONS_MAX = 10;

const COMBINAISONS_DEFAUT = 5;

export interface OptionsCombinaisons {
  /** Taille maximale k (borne : `PRATIQUES_MAX_COMBINAISON`). */
  readonly pratiquesMax?: number;
  /** Nœuds explorés au plus (borne : `NOEUDS_MAX_COMBINAISONS`). */
  readonly noeudsMax?: number;
  /** Combinaisons retournées au plus (défaut 5, borne : `COMBINAISONS_MAX`). */
  readonly maxCombinaisons?: number;
}

/** Pratique répondue relevable, avec ses paliers (points, croissants). */
export interface LevierAmelioration {
  readonly dimension: string;
  readonly libelle: string;
  readonly indicateur: string;
  readonly question: string;
  readonly pointsActuels: number;
  readonly paliers: readonly number[];
}

export interface EtapeCombinaison {
  readonly dimension: string;
  readonly libelle: string;
  readonly indicateur: string;
  readonly question: string;
  readonly pointsAvant: number;
  readonly pointsApres: number;
  /** Nombre de crans franchis (rang du palier cible dans `paliersAuDessus`). */
  readonly paliers: number;
  /** Gain sur le score global (points sur 100), en séquence dans l'ordre de la grille. */
  readonly gain: number;
}

export interface CombinaisonAmelioration {
  readonly etapes: readonly EtapeCombinaison[];
  readonly scoreProjete: number;
  readonly classeProjetee: Classe;
  readonly nombrePaliers: number;
}

export interface RechercheCombinaisons {
  readonly classeActuelle: Classe;
  readonly scoreActuel: number;
  readonly cible: Classe;
  readonly seuil: number;
  readonly dejaAtteinte: boolean;
  /** Une combinaison existe dans les bornes (jamais conclu « non » sur une recherche interrompue). */
  readonly atteignable: boolean;
  readonly gainNecessaire: number;
  /** k* : plus petit nombre de pratiques à relever (null si aucune combinaison dans les bornes). */
  readonly nombreMinimalPratiques: number | null;
  readonly combinaisons: readonly CombinaisonAmelioration[];
  /** Vrai si la recherche a été menée à terme dans les bornes : k* et la liste sont exacts. */
  readonly exhaustive: boolean;
  /** Vrai si une borne a interrompu la recherche : l'impossibilité n'est alors pas établie. */
  readonly tronquee: boolean;
  readonly leviers: readonly LevierAmelioration[];
}

/** Paliers de points strictement au-dessus de `x` pour une règle : croissants, sans doublon. */
export function paliersAuDessus(regle: RegleConversion, x: Fraction): Fraction[] {
  if (regle.type === "likert") {
    const n = BigInt(regle.points - 1);
    // Points affichés au dixième : même tolérance (± 0,05) que `palierSuivant`.
    const niveau = multiplier(ajouter(x, fraction(1n, 20n)), fraction(n, 100n));
    const sortie: Fraction[] = [];
    for (let k = niveau.num / niveau.den + 1n; k <= n; k++) sortie.push(fraction(k * 100n, n));
    return sortie;
  }
  let valeurs: Fraction[];
  switch (regle.type) {
    case "choix":
      valeurs = regle.valeurs.map((v) => depuisNombre(v.points));
      break;
    case "oui_non":
      valeurs = [depuisNombre(regle.oui), depuisNombre(regle.non)];
      break;
    case "seuils":
      valeurs = regle.paliers.map((p) => depuisNombre(p.points));
      break;
    case "interpolation":
      valeurs = regle.points.map((p) => depuisNombre(p.y));
      break;
    case "choix_multiple":
      valeurs = [pointsMaximaux(regle)];
      break;
  }
  const tries = valeurs.filter((v) => comparer(v, x) > 0).sort((a, b) => comparer(a, b));
  return tries.filter((v, i) => i === 0 || comparer(v, tries[i - 1] as Fraction) !== 0);
}

interface Levier {
  readonly pos: number;
  readonly d: number;
  readonly pratique: PratiqueCalcul;
  readonly cibles: readonly Fraction[];
  /** Hausse du brut de la dimension pour chaque palier cible. */
  readonly hausses: readonly Fraction[];
}

interface Choix {
  readonly levier: Levier;
  /** Indice du palier dans `cibles` (rang − 1). */
  readonly palier: number;
}

interface Trouvee {
  readonly choix: readonly Choix[];
  readonly cout: number;
  readonly gain: Fraction;
}

function optionEntiere(valeur: number | undefined, defaut: number, max: number, nom: string) {
  const v = valeur ?? defaut;
  if (!Number.isInteger(v) || v < 1 || v > max) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", `Option « ${nom} » invalide.`);
  }
  return v;
}

const borne100 = (v: Fraction) => borner(v, ZERO, CENT);

const dimensionDe = (base: BaseCalcul, d: number) => base.dimensions[d] as DimensionCalcul;

/** Recherche exacte des combinaisons minimales d'améliorations (règles en tête du fichier). */
export function rechercherCombinaisons(
  etat: ScoreAjuste,
  grille: GrilleNotation,
  cible: Classe,
  options: OptionsCombinaisons = {},
): RechercheCombinaisons {
  const pratiquesMax = optionEntiere(
    options.pratiquesMax,
    PRATIQUES_MAX_COMBINAISON,
    PRATIQUES_MAX_COMBINAISON,
    "pratiquesMax",
  );
  const noeudsMax = optionEntiere(
    options.noeudsMax,
    NOEUDS_MAX_COMBINAISONS,
    NOEUDS_MAX_COMBINAISONS,
    "noeudsMax",
  );
  const nombreMax = optionEntiere(
    options.maxCombinaisons,
    COMBINAISONS_DEFAUT,
    COMBINAISONS_MAX,
    "maxCombinaisons",
  );
  const palier = BAREME_CLASSES.find((b) => b.classe === cible);
  if (!palier) throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Classe visée inconnue.");
  const base = baseCalcul(etat, grille);
  const seuil = depuisNombre(palier.min);
  const actuelle = etat.classe as Classe;
  const deja = rangClasse(actuelle) >= rangClasse(cible);
  const entete = {
    classeActuelle: actuelle,
    scoreActuel: etat.score as number,
    cible,
    seuil: palier.min,
    dejaAtteinte: deja,
    gainNecessaire: deja ? 0 : arrondir(soustraire(seuil, depuisNombre(etat.score as number))),
  };
  if (deja) {
    return {
      ...entete,
      atteignable: true,
      nombreMinimalPratiques: 0,
      combinaisons: [],
      exhaustive: true,
      tronquee: false,
      leviers: [],
    };
  }
  // Cible atteinte quand l'arrondi au dixième du global atteint le seuil : global ≥ seuil − 0,05.
  const besoin = soustraire(soustraire(seuil, fraction(1n, 20n)), base.global);

  const leviers = construireLeviers(base);
  const sortieLeviers: LevierAmelioration[] = leviers.map((l) => ({
    dimension: dimensionDe(base, l.d).res.dimension,
    libelle: dimensionDe(base, l.d).res.libelle,
    indicateur: l.pratique.indicateur,
    question: l.pratique.question,
    pointsActuels: l.pratique.points as number,
    paliers: l.cibles.map((c) => arrondir(c)),
  }));
  const sansCombinaison = (exhaustive: boolean): RechercheCombinaisons => ({
    ...entete,
    atteignable: false,
    nombreMinimalPratiques: null,
    combinaisons: [],
    exhaustive,
    tronquee: !exhaustive,
    leviers: sortieLeviers,
  });

  const kEtoile = nombreMinimal(base, leviers, besoin);
  if (kEtoile === null) return sansCombinaison(true); // inatteignable : établi
  if (kEtoile > pratiquesMax) return sansCombinaison(false); // borne de taille : rien n'est établi

  const enumeration = enumerer(base, leviers, besoin, kEtoile, nombreMax, noeudsMax);
  return {
    ...entete,
    atteignable: true,
    nombreMinimalPratiques: kEtoile,
    combinaisons: enumeration.trouvees.map((c) => presenter(base, c)),
    exhaustive: !enumeration.interrompue,
    tronquee: enumeration.interrompue,
    leviers: sortieLeviers,
  };
}

/** Leviers utiles, dans l'ordre de la grille ; écarte les dimensions où rien ne peut changer. */
function construireLeviers(base: BaseCalcul): Levier[] {
  const sortie: Levier[] = [];
  base.dimensions.forEach((dim, d) => {
    if (dim.brut === null || estNul(dim.poids) || estNul(dim.denominateur)) return;
    const candidats: Omit<Levier, "pos">[] = [];
    for (const pratique of dim.pratiques) {
      if (pratique.statut !== "repondu" || pratique.points === null) continue;
      if (estNul(pratique.poids)) continue;
      const avant = depuisNombre(pratique.points);
      const cibles = paliersAuDessus(pratique.conversion, avant);
      if (cibles.length === 0) continue;
      const hausses = cibles.map((t) =>
        diviser(multiplier(pratique.poids, soustraire(t, avant)), dim.denominateur),
      );
      candidats.push({ d, pratique, cibles, hausses });
    }
    const total = candidats.reduce(
      (s, c) => ajouter(s, c.hausses[c.hausses.length - 1] as Fraction),
      ZERO,
    );
    // Dimension saturée, ou brut négatif qui ne peut pas revenir au-dessus de zéro : rien à gagner.
    if (comparer(borne100(ajouter(dim.brut, total)), borne100(dim.brut)) === 0) return;
    for (const c of candidats) sortie.push({ ...c, pos: sortie.length });
  });
  return sortie;
}

/** Gain pondéré (sur le score global) d'une dimension dont le brut monte de `hausse`. */
function gainDimension(base: BaseCalcul, d: number, hausse: Fraction): Fraction {
  const dim = dimensionDe(base, d);
  const brut = dim.brut as Fraction;
  const effectif = soustraire(borne100(ajouter(brut, hausse)), borne100(brut));
  return diviser(multiplier(dim.poids, effectif), base.D);
}

/** k* exact : plus petit nombre de pratiques (tous paliers maximaux) atteignant le besoin. */
function nombreMinimal(
  base: BaseCalcul,
  leviers: readonly Levier[],
  besoin: Fraction,
): number | null {
  const parDimension = new Map<number, Fraction[]>();
  for (const l of leviers) {
    const liste = parDimension.get(l.d) ?? [];
    liste.push(l.hausses[l.hausses.length - 1] as Fraction);
    parDimension.set(l.d, liste);
  }
  // meilleur[c] : gain maximal avec au plus c pratiques (sac-à-dos sur les dimensions).
  let meilleur: Fraction[] = new Array<Fraction>(leviers.length + 1).fill(ZERO);
  for (const [d, hausses] of parDimension) {
    hausses.sort((a, b) => comparer(b, a));
    const f: Fraction[] = [ZERO];
    let cumul = ZERO;
    for (const h of hausses) {
      cumul = ajouter(cumul, h);
      f.push(gainDimension(base, d, cumul));
    }
    const precedent = meilleur;
    meilleur = precedent.map((_, c) => {
      let max = ZERO;
      for (let j = 0; j <= Math.min(c, hausses.length); j++) {
        const v = ajouter(precedent[c - j] as Fraction, f[j] as Fraction);
        if (comparer(v, max) > 0) max = v;
      }
      return max;
    });
  }
  const k = meilleur.findIndex((g) => comparer(g, besoin) >= 0);
  return k < 0 ? null : k;
}

/** Ordre : paliers franchis, puis pratiques dans l'ordre de la grille, puis paliers croissants. */
function comparerTrouvees(a: Trouvee, b: Trouvee): number {
  const cle = (t: Trouvee) => [
    t.cout,
    ...t.choix.map((c) => c.levier.pos),
    ...t.choix.map((c) => c.palier),
  ];
  const ka = cle(a);
  const kb = cle(b);
  const i = ka.findIndex((v, j) => v !== kb[j]);
  return i < 0 ? 0 : (ka[i] as number) - (kb[i] as number);
}

function gainTotal(base: BaseCalcul, choix: readonly Choix[]): Fraction {
  const hausses = new Map<number, Fraction>();
  for (const c of choix) {
    const h = c.levier.hausses[c.palier] as Fraction;
    hausses.set(c.levier.d, ajouter(hausses.get(c.levier.d) ?? ZERO, h));
  }
  let total = ZERO;
  for (const [d, h] of hausses) total = ajouter(total, gainDimension(base, d, h));
  return total;
}

function enumerer(
  base: BaseCalcul,
  leviers: readonly Levier[],
  besoin: Fraction,
  k: number,
  nombreMax: number,
  noeudsMax: number,
) {
  const m = leviers.length;
  // Potentiel d'un levier : borne de son apport au global (la borne de dimension est 1-lipschitzienne).
  const potentiels = leviers.map((l) =>
    diviser(
      multiplier(dimensionDe(base, l.d).poids, l.hausses[l.hausses.length - 1] as Fraction),
      base.D,
    ),
  );
  // prefixe[pos][r] : somme des r plus grands potentiels parmi les leviers d'indice ≥ pos
  // (null s'il en reste moins de r).
  const prefixe: (Fraction | null)[][] = [];
  for (let pos = 0; pos <= m; pos++) {
    const tries = potentiels.slice(pos).sort((a, b) => comparer(b, a));
    const ligne: (Fraction | null)[] = [ZERO];
    let cumul = ZERO;
    for (let r = 1; r <= k; r++) {
      const p = tries[r - 1];
      if (p === undefined) {
        ligne.push(null);
      } else {
        cumul = ajouter(cumul, p);
        ligne.push(cumul);
      }
    }
    prefixe.push(ligne);
  }

  const trouvees: Trouvee[] = [];
  const hausses = new Map<number, Fraction>();
  const gains = new Map<number, Fraction>();
  const choix: Choix[] = [];
  let noeuds = 0;
  let interrompue = false;
  let gain = ZERO;

  // Irréductible : retirer une amélioration, ou la réduire d'un cran, fait manquer la cible.
  const irreductible = (): boolean =>
    choix.every((c, i) => {
      const reduit =
        c.palier === 0
          ? choix.filter((_, j) => j !== i)
          : choix.map((x, j) => (j === i ? { levier: x.levier, palier: x.palier - 1 } : x));
      return comparer(gainTotal(base, reduit), besoin) < 0;
    });

  const visiter = (pos: number, cout: number): void => {
    if (++noeuds > noeudsMax) {
      interrompue = true;
      return;
    }
    const restant = k - choix.length;
    if (restant === 0) {
      if (comparer(gain, besoin) >= 0 && irreductible()) {
        trouvees.push({ choix: [...choix], cout, gain });
        trouvees.sort(comparerTrouvees);
        if (trouvees.length > nombreMax) trouvees.pop();
      }
      return;
    }
    const potentiel = (prefixe[pos] as (Fraction | null)[])[restant] as Fraction | null;
    if (potentiel === null || comparer(ajouter(gain, potentiel), besoin) < 0) return;
    // Liste pleine : un coût strictement supérieur au pire retenu ne peut plus entrer.
    if (
      trouvees.length >= nombreMax &&
      cout + restant > (trouvees[nombreMax - 1] as Trouvee).cout
    ) {
      return;
    }
    for (let p = pos; p <= m - restant; p++) {
      const l = leviers[p] as Levier;
      const avantH = hausses.get(l.d) ?? ZERO;
      const avantG = gains.get(l.d) ?? ZERO;
      for (let j = 0; j < l.cibles.length; j++) {
        const nouvelleH = ajouter(avantH, l.hausses[j] as Fraction);
        const nouveauG = gainDimension(base, l.d, nouvelleH);
        const gainAvant = gain;
        hausses.set(l.d, nouvelleH);
        gains.set(l.d, nouveauG);
        gain = ajouter(gain, soustraire(nouveauG, avantG));
        choix.push({ levier: l, palier: j });
        visiter(p + 1, cout + j + 1);
        choix.pop();
        gain = gainAvant;
        hausses.set(l.d, avantH);
        gains.set(l.d, avantG);
        if (interrompue) return;
      }
    }
  };
  visiter(0, 0);
  return { trouvees, interrompue };
}

function presenter(base: BaseCalcul, combinaison: Trouvee): CombinaisonAmelioration {
  const hausses = new Map<number, Fraction>();
  const etapes = combinaison.choix.map(({ levier, palier }): EtapeCombinaison => {
    const avant = hausses.get(levier.d) ?? ZERO;
    const apres = ajouter(avant, levier.hausses[palier] as Fraction);
    hausses.set(levier.d, apres);
    return {
      dimension: dimensionDe(base, levier.d).res.dimension,
      libelle: dimensionDe(base, levier.d).res.libelle,
      indicateur: levier.pratique.indicateur,
      question: levier.pratique.question,
      pointsAvant: levier.pratique.points as number,
      pointsApres: arrondir(levier.cibles[palier] as Fraction),
      paliers: palier + 1,
      gain: arrondir(
        soustraire(gainDimension(base, levier.d, apres), gainDimension(base, levier.d, avant)),
        2,
      ),
    };
  });
  const projete = arrondir(ajouter(base.global, combinaison.gain));
  return {
    etapes,
    scoreProjete: projete,
    classeProjetee: classeDe(projete),
    nombrePaliers: combinaison.cout,
  };
}
