/**
 * Explicabilité de la note (NOT-12, PRD complémentaire §11.1).
 *
 * 1. Contribution de chaque dimension et de chaque pratique (indicateur de la grille) au score
 *    global AJUSTÉ, en points sur 100 :
 *    - dimension d notable : w_d × s_d / D, où s_d est le score ajusté exact, w_d le poids
 *      normalisé exact et D la somme des poids des dimensions notables (stratégie « ignorer »)
 *      ou 100 (« pénaliser ») ; la somme des contributions des dimensions EST le score global ;
 *    - pratique i répondue de d : (w_d / D) × p_i × x_i / Σ p, où p_i est son poids, x_i ses
 *      points (affichés, au dixième) et Σ p le poids des pratiques répondues (« ignorer ») ou
 *      applicables (« pénaliser ») ;
 *    - ajustement motivé de d : (w_d / D) × (score ajusté − score calculé) ;
 *    - écart d'arrondi : reste dû aux points de pratique affichés au dixième.
 * 2. Simulateur « que faut-il pour passer de C à B » : à partir de l'état courant, on relève une
 *    pratique répondue d'un palier à la fois (Likert : niveau suivant ; autre règle : points
 *    maximaux de la règle), en choisissant à chaque pas le palier qui fait gagner le plus de
 *    points au score global (à gain égal : ordre de la grille), jusqu'à atteindre le seuil de la
 *    classe visée (score affiché au dixième) ou épuiser les paliers. Le score d'une dimension suit
 *    la règle de l'ajustement : score calculé + ajustement cumulé, BORNÉ à [0, 100] ; le
 *    simulateur garde le total BRUT non borné de chaque dimension et applique la borne à chaque
 *    pas (un gain au-delà de 100 est perdu ; une dimension dont le brut est négatif ne gagne rien
 *    tant qu'il n'est pas revenu à zéro : aucun de ses paliers n'est alors proposé, la simulation
 *    est prudente). Le nombre de pas est plafonné à `PAS_MAX` :
 *    si le plafond coupe la simulation avant la cible, `tronquee` le dit (jamais en silence).
 *    Projection indicative, calculée par le moteur ; elle ne crée aucune note.
 */
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import type { ScoreAjuste } from "./ajustement";
import { BAREME_CLASSES, classe as classeDe, rangClasse, type Classe } from "./classes";
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
  fraction,
  multiplier,
  somme,
  soustraire,
  type Fraction,
} from "./fraction";
import type { GrilleNotation, RegleConversion } from "./grille";
import type { DimensionNotee, StatutIndicateur } from "./score";

export interface ContributionPratique {
  readonly indicateur: string;
  readonly question: string;
  readonly statut: StatutIndicateur;
  readonly points: number | null;
  readonly poids: number;
  readonly contribution: number;
}

export interface ContributionDimension {
  readonly dimension: string;
  readonly libelle: string;
  readonly notable: boolean;
  readonly poids: number;
  readonly score: number | null;
  readonly contribution: number;
  readonly ajustement: number;
  readonly ecartArrondi: number;
  readonly pratiques: readonly ContributionPratique[];
}

export interface ExplicationNote {
  readonly score: number;
  readonly classe: Classe;
  readonly strategie: "ignorer" | "penaliser";
  readonly sommeContributions: number;
  readonly dimensions: readonly ContributionDimension[];
}

interface PratiqueCalcul {
  readonly indicateur: string;
  readonly question: string;
  readonly statut: StatutIndicateur;
  readonly points: number | null;
  readonly poids: Fraction;
  readonly conversion: RegleConversion;
}

interface DimensionCalcul {
  readonly res: DimensionNotee;
  readonly poids: Fraction;
  readonly calcule: Fraction | null;
  readonly ajuste: Fraction | null;
  /** Score calculé + ajustement cumulé, SANS borne (null si la dimension n'est pas notable). */
  readonly brut: Fraction | null;
  readonly denominateur: Fraction;
  readonly pratiques: readonly PratiqueCalcul[];
}

interface BaseCalcul {
  readonly dimensions: readonly DimensionCalcul[];
  readonly D: Fraction;
  readonly global: Fraction;
}

function nonNotable(): never {
  throw new ErreurNotationAugmentee(
    "NOTE_NON_NOTABLE",
    "Le score global n'est pas notable : aucune explication ni simulation possible.",
  );
}

function pratiquesDe(res: DimensionNotee, grille: GrilleNotation): PratiqueCalcul[] {
  const dim = grille.dimensions.find((d) => d.id === res.dimension);
  return res.indicateurs.map((i) => {
    const ind = dim?.indicateurs.find((x) => x.id === i.indicateur);
    if (!ind) {
      throw new ErreurNotationAugmentee(
        "OPTIONS_INVALIDES",
        `La grille ne correspond pas au calcul (indicateur « ${i.indicateur} »).`,
      );
    }
    return { ...i, poids: depuisNombre(ind.poids), conversion: ind.conversion };
  });
}

function baseCalcul(etat: ScoreAjuste, grille: GrilleNotation): BaseCalcul {
  if (!etat.notable || etat.score === null) nonNotable();
  const penaliser = etat.calcule.strategie === "penaliser";
  const dimensions = etat.calcule.dimensions.map((res) => {
    const ajustee = etat.dimensions.find((d) => d.dimension === res.dimension);
    const calcule = res.scoreExact === null ? null : depuisTexte(res.scoreExact);
    const cumul = depuisNombre(ajustee?.deltaCumule ?? 0);
    const brut = calcule === null ? null : ajouter(calcule, cumul);
    const pratiques = pratiquesDe(res, grille);
    const comptees = pratiques.filter((p) =>
      penaliser ? p.statut !== "sans_objet" : p.statut === "repondu",
    );
    return {
      res,
      poids: depuisTexte(res.poidsExact),
      calcule,
      ajuste: brut === null ? null : borner(brut, ZERO, CENT),
      brut,
      denominateur: somme(comptees.map((p) => p.poids)),
      pratiques,
    };
  });
  const notables = dimensions.filter((d) => d.ajuste !== null && !estNul(d.poids));
  const D = penaliser ? CENT : somme(notables.map((d) => d.poids));
  const global = diviser(somme(notables.map((d) => multiplier(d.poids, d.ajuste as Fraction))), D);
  return { dimensions, D, global };
}

function contributionDimension(d: DimensionCalcul, D: Fraction): ContributionDimension {
  const part = diviser(d.poids, D);
  const notable = d.ajuste !== null && d.calcule !== null && !estNul(d.poids);
  const pratiques = d.pratiques.map((p) => {
    const exacte =
      notable && p.statut === "repondu" && p.points !== null && !estNul(d.denominateur)
        ? diviser(multiplier(part, multiplier(p.poids, depuisNombre(p.points))), d.denominateur)
        : ZERO;
    return { p, exacte };
  });
  const totale = notable ? multiplier(part, d.ajuste as Fraction) : ZERO;
  const ajustement = notable
    ? multiplier(part, soustraire(d.ajuste as Fraction, d.calcule as Fraction))
    : ZERO;
  const reste = soustraire(soustraire(totale, somme(pratiques.map((x) => x.exacte))), ajustement);
  return {
    dimension: d.res.dimension,
    libelle: d.res.libelle,
    notable,
    poids: d.res.poids,
    score: notable ? arrondir(d.ajuste as Fraction) : null,
    contribution: arrondir(totale, 2),
    ajustement: arrondir(ajustement, 2),
    ecartArrondi: arrondir(reste, 2),
    pratiques: pratiques.map(({ p, exacte }) => ({
      indicateur: p.indicateur,
      question: p.question,
      statut: p.statut,
      points: p.points,
      poids: arrondir(p.poids, 4),
      contribution: arrondir(exacte, 2),
    })),
  };
}

/** Contributions des dimensions et des pratiques au score global ajusté. */
export function expliquerNote(etat: ScoreAjuste, grille: GrilleNotation): ExplicationNote {
  const base = baseCalcul(etat, grille);
  const dimensions = base.dimensions.map((d) => contributionDimension(d, base.D));
  return {
    score: etat.score as number,
    classe: etat.classe as Classe,
    strategie: etat.calcule.strategie,
    sommeContributions: arrondir(base.global, 2),
    dimensions,
  };
}

/* ---------- Simulateur ---------- */

export interface EtapeSimulation {
  readonly dimension: string;
  readonly libelle: string;
  readonly indicateur: string;
  readonly question: string;
  readonly pointsAvant: number;
  readonly pointsApres: number;
  readonly paliers: number;
  readonly gain: number;
}

export interface SimulationPassage {
  readonly classeActuelle: Classe;
  readonly scoreActuel: number;
  readonly cible: Classe;
  readonly seuil: number;
  readonly dejaAtteinte: boolean;
  readonly atteignable: boolean;
  readonly gainNecessaire: number;
  readonly scoreProjete: number;
  readonly classeProjetee: Classe;
  readonly etapes: readonly EtapeSimulation[];
  /** Vrai si le plafond de pas (`PAS_MAX`) a interrompu la simulation avant la cible. */
  readonly tronquee: boolean;
}

/** Points maximaux qu'une règle de conversion peut donner. */
export function pointsMaximaux(regle: RegleConversion): Fraction {
  switch (regle.type) {
    case "likert":
      return CENT;
    case "choix":
      return regle.valeurs.reduce((m, v) => maxF(m, depuisNombre(v.points)), ZERO);
    case "choix_multiple":
      return borner(somme(regle.valeurs.map((v) => depuisNombre(v.points))), ZERO, CENT);
    case "oui_non":
      return maxF(depuisNombre(regle.oui), depuisNombre(regle.non));
    case "seuils":
      return regle.paliers.reduce((m, p) => maxF(m, depuisNombre(p.points)), ZERO);
    case "interpolation":
      return regle.points.reduce((m, p) => maxF(m, depuisNombre(p.y)), ZERO);
  }
}

function maxF(a: Fraction, b: Fraction): Fraction {
  return comparer(a, b) >= 0 ? a : b;
}

/** Palier suivant des points `x` (affichés au dixième), ou null s'il n'y en a plus. */
export function palierSuivant(regle: RegleConversion, x: Fraction): Fraction | null {
  if (regle.type === "likert") {
    const n = BigInt(regle.points - 1);
    // Points affichés au dixième : on tolère l'arrondi (± 0,05) avant de lire le niveau.
    const niveau = multiplier(ajouter(x, fraction(1n, 20n)), fraction(n, 100n));
    const k = niveau.num / niveau.den + 1n;
    return k > n ? null : fraction(k * 100n, n);
  }
  const max = pointsMaximaux(regle);
  return comparer(x, max) >= 0 ? null : max;
}

interface Candidat {
  readonly d: number;
  readonly i: number;
  readonly suivant: Fraction;
  /** Gain EFFECTIF sur le score global (après borne de la dimension à [0, 100]). */
  readonly gain: Fraction;
  /** Hausse du total BRUT de la dimension (avant borne). */
  readonly hausse: Fraction;
}

interface EtatSimulation {
  /** Total brut non borné par dimension : score calculé + ajustement cumulé (+ hausses simulées). */
  readonly bruts: Fraction[];
  readonly points: (Fraction | null)[][];
}

const borne100 = (v: Fraction) => borner(v, ZERO, CENT);

function candidat(base: BaseCalcul, etat: EtatSimulation, d: number, i: number): Candidat | null {
  const dim = base.dimensions[d] as DimensionCalcul;
  const p = dim.pratiques[i] as PratiqueCalcul;
  const x = (etat.points[d] as (Fraction | null)[])[i] ?? null;
  if (p.statut !== "repondu" || x === null) return null;
  const suivant = palierSuivant(p.conversion, x);
  if (suivant === null) return null;
  const hausse = diviser(multiplier(p.poids, soustraire(suivant, x)), dim.denominateur);
  const avant = etat.bruts[d] as Fraction;
  // Dimension déjà saturée (≥ 100) : aucune hausse ne compte.
  if (comparer(avant, CENT) >= 0 || estNul(hausse)) return null;
  const effectif = soustraire(borne100(ajouter(avant, hausse)), borne100(avant));
  // Un palier sans effet sur le score borné (brut encore négatif) n'est pas proposé : la
  // simulation est prudente, elle ne promet jamais un gain qui n'existe pas.
  if (estNul(effectif)) return null;
  return { d, i, suivant, gain: diviser(multiplier(dim.poids, effectif), base.D), hausse };
}

/** Meilleur palier : gain effectif le plus grand ; à gain égal, la plus forte hausse brute. */
function meilleurCandidat(base: BaseCalcul, etat: EtatSimulation): Candidat | null {
  let meilleur: Candidat | null = null;
  for (let d = 0; d < base.dimensions.length; d++) {
    const dim = base.dimensions[d] as DimensionCalcul;
    if (dim.ajuste === null || estNul(dim.poids) || estNul(dim.denominateur)) continue;
    for (let i = 0; i < dim.pratiques.length; i++) {
      const c = candidat(base, etat, d, i);
      if (c === null) continue;
      const mieux =
        meilleur === null ||
        comparer(c.gain, meilleur.gain) > 0 ||
        (comparer(c.gain, meilleur.gain) === 0 && comparer(c.hausse, meilleur.hausse) > 0);
      if (mieux) meilleur = c;
    }
  }
  return meilleur;
}

/** Nombre maximal de paliers relevés par une simulation (au-delà : `tronquee`). */
export const PAS_MAX = 1_000;

/** Simulation du passage à la classe `cible` (règles en tête du fichier). */
export function simulerPassage(
  etat: ScoreAjuste,
  grille: GrilleNotation,
  cible: Classe,
  options: { readonly pasMax?: number } = {},
): SimulationPassage {
  const pasMax = options.pasMax ?? PAS_MAX;
  if (!Number.isInteger(pasMax) || pasMax < 1 || pasMax > PAS_MAX) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Nombre de pas invalide.");
  }
  const palier = BAREME_CLASSES.find((b) => b.classe === cible);
  if (!palier) throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Classe visée inconnue.");
  const base = baseCalcul(etat, grille);
  const seuil = depuisNombre(palier.min);
  const actuelle = etat.classe as Classe;
  const deja = rangClasse(actuelle) >= rangClasse(cible);
  const simulation: EtatSimulation = {
    bruts: base.dimensions.map((d) => d.brut ?? ZERO),
    points: base.dimensions.map((d) =>
      d.pratiques.map((p) => (p.points === null ? null : depuisNombre(p.points))),
    ),
  };
  let global = base.global;
  const etapes = new Map<string, EtapeSimulation>();
  const gains = new Map<string, Fraction>();
  let pas = 0;
  let tronquee = false;
  while (!deja && arrondir(global) < palier.min) {
    if (pas >= pasMax) {
      // Plafond de pas atteint alors que la cible ne l'est pas : on ne conclut pas à l'épuisement
      // des paliers, on le signale (sauf s'il n'en reste réellement aucun).
      tronquee = meilleurCandidat(base, simulation) !== null;
      break;
    }
    pas++;
    const c = meilleurCandidat(base, simulation);
    if (c === null) break;
    const dim = base.dimensions[c.d] as DimensionCalcul;
    const p = dim.pratiques[c.i] as PratiqueCalcul;
    const cle = `${dim.res.dimension}/${p.indicateur}`;
    const avant = etapes.get(cle);
    const gain = ajouter(gains.get(cle) ?? ZERO, c.gain);
    gains.set(cle, gain);
    (simulation.points[c.d] as (Fraction | null)[])[c.i] = c.suivant;
    simulation.bruts[c.d] = ajouter(simulation.bruts[c.d] as Fraction, c.hausse);
    global = ajouter(global, c.gain);
    etapes.set(cle, {
      dimension: dim.res.dimension,
      libelle: dim.res.libelle,
      indicateur: p.indicateur,
      question: p.question,
      pointsAvant: avant?.pointsAvant ?? (p.points as number),
      pointsApres: arrondir(c.suivant),
      paliers: (avant?.paliers ?? 0) + 1,
      gain: arrondir(gain, 2),
    });
  }
  const projete = arrondir(global);
  return {
    classeActuelle: actuelle,
    scoreActuel: etat.score as number,
    cible,
    seuil: palier.min,
    dejaAtteinte: deja,
    atteignable: deja || projete >= palier.min,
    gainNecessaire: deja ? 0 : arrondir(soustraire(seuil, depuisNombre(etat.score as number))),
    scoreProjete: projete,
    classeProjetee: classeDe(projete),
    etapes: [...etapes.values()],
    tronquee,
  };
}
