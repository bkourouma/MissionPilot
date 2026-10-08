/**
 * Plan d'action construit depuis la bibliothèque d'initiatives types (NOT-17, PRD
 * complémentaire §11.1) : priorisé par l'impact observé dans des contextes semblables et la
 * capacité du client.
 *
 * Règles (valeurs à calibrer au pilote) :
 * - besoin d'une initiative : Σ sur les dimensions NOTABLES qu'elle cible de
 *   (poids normalisé / 100) × (100 − score ajusté) / 100, de 0 à 1. HYPOTHÈSE : les poids
 *   normalisés du résultat (`poidsExact`, en centièmes) somment à 100 ; si une dimension n'est
 *   pas notable (stratégie « ignorer »), la somme des poids restants est inférieure à 100 et le
 *   besoin maximal l'est aussi — les initiatives restent comparables entre elles (même base) ;
 * - impact observé : moyenne des gains (points de note) observés pour l'initiative dans le
 *   contexte le plus proche disponible, dans cet ordre : même secteur ET même taille, même
 *   secteur, même taille, tous contextes ; secteurs et tailles se comparent sans tenir compte de
 *   la casse ni des espaces de bord ; aucun gain observé → impact 0 (source « aucun ») ;
 * - priorité = besoin × impact / effort (effort de 1 à 5) ; tri décroissant, à priorité égale
 *   l'effort le plus faible puis le code ;
 * - capacité du client : somme d'efforts qu'il peut absorber ; les initiatives sont retenues
 *   dans l'ordre de priorité tant que la capacité le permet (une initiative trop lourde est
 *   sautée, la suivante peut être retenue), au plus `maxInitiatives` ; une initiative de
 *   priorité nulle n'est jamais retenue.
 */
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import type { ScoreAjuste } from "./ajustement";
import {
  CENT,
  ZERO,
  arrondir,
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

export interface ImpactObserve {
  readonly secteur: string | null;
  readonly taille: string | null;
  /** Gain de note observé (points sur 100, une décimale). */
  readonly gain: number;
}

export interface InitiativeType {
  readonly code: string;
  readonly titre: string;
  readonly dimensions: readonly string[];
  readonly effort: number;
  readonly dureeMois: number;
  readonly impacts: readonly ImpactObserve[];
}

export interface ContextePlan {
  readonly secteur: string | null;
  readonly taille: string | null;
}

export interface OptionsPlan {
  readonly capacite: number;
  readonly maxInitiatives?: number;
}

export type SourceImpact = "contexte_semblable" | "secteur" | "taille" | "general" | "aucun";

export interface InitiativePriorisee {
  readonly code: string;
  readonly titre: string;
  readonly rang: number;
  readonly priorite: number;
  readonly besoin: number;
  readonly impact: number;
  readonly sourceImpact: SourceImpact;
  readonly observations: number;
  readonly effort: number;
  readonly dureeMois: number;
  readonly dimensions: readonly string[];
  readonly retenue: boolean;
  readonly motif: string;
}

export interface PlanActionPriorise {
  readonly capacite: number;
  readonly capaciteUtilisee: number;
  readonly initiatives: readonly InitiativePriorisee[];
}

function verifier(initiatives: readonly InitiativeType[], options: OptionsPlan): number {
  const refus = (m: string) => new ErreurNotationAugmentee("INITIATIVES_INVALIDES", m);
  if (!Number.isInteger(options.capacite) || options.capacite < 1 || options.capacite > 100) {
    throw refus("La capacité du client est un entier de 1 à 100.");
  }
  const max = options.maxInitiatives ?? 20;
  if (!Number.isInteger(max) || max < 1 || max > 100)
    throw refus("Plafond d'initiatives invalide.");
  const codes = new Set<string>();
  for (const i of initiatives) {
    if (codes.has(i.code)) throw refus(`Initiative en double : « ${i.code} ».`);
    codes.add(i.code);
    if (i.titre.trim() === "" || i.titre.length > 200) {
      throw refus(`Titre de 1 à 200 caractères attendu pour « ${i.code} ».`);
    }
    if (!Number.isInteger(i.dureeMois) || i.dureeMois < 1 || i.dureeMois > 60) {
      throw refus(`Durée de 1 à 60 mois attendue pour « ${i.code} ».`);
    }
    if (!Number.isInteger(i.effort) || i.effort < 1 || i.effort > 5) {
      throw refus(`Effort de 1 à 5 attendu pour « ${i.code} ».`);
    }
    if (!i.impacts.every((x) => Number.isFinite(x.gain) && x.gain >= 0 && x.gain <= 100)) {
      throw refus(`Gain observé hors de 0 à 100 pour « ${i.code} ».`);
    }
  }
  return max;
}

const normaliser = (v: string) => v.trim().toLowerCase();

function impactRetenu(
  impacts: readonly ImpactObserve[],
  contexte: ContextePlan,
): { impact: Fraction; source: SourceImpact; observations: number } {
  const memeSecteur = (x: ImpactObserve) =>
    contexte.secteur !== null &&
    x.secteur !== null &&
    normaliser(x.secteur) === normaliser(contexte.secteur);
  const memeTaille = (x: ImpactObserve) =>
    contexte.taille !== null &&
    x.taille !== null &&
    normaliser(x.taille) === normaliser(contexte.taille);
  const niveaux: [SourceImpact, (x: ImpactObserve) => boolean][] = [
    ["contexte_semblable", (x) => memeSecteur(x) && memeTaille(x)],
    ["secteur", memeSecteur],
    ["taille", memeTaille],
    ["general", () => true],
  ];
  for (const [source, filtre] of niveaux) {
    const retenus = impacts.filter(filtre);
    if (retenus.length > 0) {
      return {
        impact: diviser(
          somme(retenus.map((x) => depuisNombre(x.gain))),
          fraction(BigInt(retenus.length)),
        ),
        source,
        observations: retenus.length,
      };
    }
  }
  return { impact: ZERO, source: "aucun", observations: 0 };
}

function besoin(etat: ScoreAjuste, dimensions: readonly string[]): Fraction {
  const cibles = new Set(dimensions);
  return somme(
    etat.calcule.dimensions.flatMap((d) => {
      const ajustee = etat.dimensions.find((x) => x.dimension === d.dimension);
      if (!cibles.has(d.dimension) || ajustee?.score === null || ajustee === undefined) return [];
      const manque = soustraire(CENT, depuisNombre(ajustee.score));
      return [diviser(multiplier(depuisTexte(d.poidsExact), manque), fraction(10_000n))];
    }),
  );
}

const LIBELLES_SOURCE: Record<SourceImpact, string> = {
  contexte_semblable: "impact observé dans des contextes semblables (secteur et taille)",
  secteur: "impact observé dans le même secteur",
  taille: "impact observé pour la même taille d'entreprise",
  general: "impact observé tous contextes confondus",
  aucun: "aucun impact observé",
};

/** Plan d'action priorisé (règles en tête du fichier). */
export function prioriserInitiatives(
  etat: ScoreAjuste,
  initiatives: readonly InitiativeType[],
  contexte: ContextePlan,
  options: OptionsPlan,
): PlanActionPriorise {
  if (!etat.notable) {
    throw new ErreurNotationAugmentee("NOTE_NON_NOTABLE", "Le score global n'est pas notable.");
  }
  const max = verifier(initiatives, options);
  const evaluees = initiatives
    .map((i) => {
      const b = besoin(etat, i.dimensions);
      const imp = impactRetenu(i.impacts, contexte);
      const priorite = diviser(multiplier(b, imp.impact), fraction(BigInt(i.effort)));
      return { i, b, imp, priorite };
    })
    .sort(
      (x, y) =>
        comparer(y.priorite, x.priorite) ||
        x.i.effort - y.i.effort ||
        (x.i.code < y.i.code ? -1 : x.i.code > y.i.code ? 1 : 0),
    );
  let utilisee = 0;
  let retenues = 0;
  const lignes = evaluees.map(({ i, b, imp, priorite }, index) => {
    let motif = LIBELLES_SOURCE[imp.source];
    let retenue = false;
    if (estNul(priorite)) motif = `${motif} ; priorité nulle : non retenue`;
    else if (retenues >= max) motif = `${motif} ; plafond d'initiatives atteint`;
    else if (utilisee + i.effort > options.capacite)
      motif = `${motif} ; dépasse la capacité du client`;
    else {
      retenue = true;
      utilisee += i.effort;
      retenues += 1;
    }
    return {
      code: i.code,
      titre: i.titre,
      rang: index + 1,
      priorite: arrondir(priorite, 4),
      besoin: arrondir(b, 4),
      impact: arrondir(imp.impact, 1),
      sourceImpact: imp.source,
      observations: imp.observations,
      effort: i.effort,
      dureeMois: i.dureeMois,
      dimensions: [...i.dimensions],
      retenue,
      motif,
    };
  });
  return { capacite: options.capacite, capaciteUtilisee: utilisee, initiatives: lignes };
}
