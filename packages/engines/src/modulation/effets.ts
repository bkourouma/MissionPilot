/**
 * Effets de modulation : clé de chaque effet, résolution des conflits par
 * priorité, état résultant.
 *
 * - Deux effets de même CLÉ (même brique, même item, même cible d'un même
 *   type d'ajustement) et de valeurs différentes sont en conflit : la priorité
 *   la plus haute l'emporte (conflit RÉSOLU) ; à priorité égale, aucun des deux
 *   ne s'applique (conflit NON RÉSOLU : l'état de référence est conservé, et la
 *   validation le signale d'avance).
 * - Les recommandations candidates s'additionnent ; les classes de risque
 *   relevées se combinent par le maximum : jamais de conflit.
 * - Ordre stable : clés et codes comparés par unités UTF-16, sans locale.
 */
import { classeRisqueMax, type ClasseRisque } from "../qualite/classes";
import type { EffetModulation } from "./types";

export function comparerCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Clé d'un effet : deux effets de même clé portent sur la même chose. */
export function cleEffet(effet: EffetModulation): string {
  switch (effet.type) {
    case "activer_brique":
    case "retirer_brique":
      return `brique:${effet.brique}`;
    case "activer_item":
    case "retirer_item":
      return `item:${effet.item}`;
    case "recommandation_candidate":
      return `recommandation:${effet.recommandation}`;
    case "relever_classe_risque":
      return `classe_risque:${effet.cible}`;
    default:
      return `${effet.type}:${effet.cible}`;
  }
}

/** Valeur d'un effet pour sa clé : deux effets de même clé et même valeur sont identiques. */
export function valeurEffet(effet: EffetModulation): string {
  switch (effet.type) {
    case "activer_brique":
    case "activer_item":
      return "active";
    case "retirer_brique":
    case "retirer_item":
      return "retiree";
    case "ponderation":
    case "seuil":
      return String(effet.valeur);
    case "benchmark":
    case "gabarit":
    case "formulation":
      return effet.choix;
    case "recommandation_candidate":
      return "proposee";
    case "relever_classe_risque":
      return effet.classe;
  }
}

/** Identité complète d'un effet (clé et valeur). */
export function signatureEffet(effet: EffetModulation): string {
  return `${cleEffet(effet)}=${valeurEffet(effet)}`;
}

export interface CandidatEffet {
  readonly regle: string;
  readonly priorite: number;
  readonly effet: EffetModulation;
}

export interface EffetApplique {
  readonly cle: string;
  readonly effet: EffetModulation;
  /** Priorité la plus haute parmi les règles qui portent l'effet retenu. */
  readonly priorite: number;
  /** Règles qui portent l'effet retenu (priorité décroissante, puis code). */
  readonly regles: readonly string[];
}

export interface ConflitModulation {
  readonly cle: string;
  /** Vrai si une priorité plus haute a départagé les effets. */
  readonly resolu: boolean;
  /** Règle dont l'effet est retenu ; null si le conflit n'est pas résolu. */
  readonly regleRetenue: string | null;
  /** Tous les effets en présence (priorité décroissante, puis code). */
  readonly candidats: readonly CandidatEffet[];
}

function trierCandidats(candidats: readonly CandidatEffet[]): CandidatEffet[] {
  return [...candidats].sort((a, b) => b.priorite - a.priorite || comparerCodes(a.regle, b.regle));
}

function applique(cle: string, porteurs: readonly CandidatEffet[]): EffetApplique {
  return {
    cle,
    effet: porteurs[0]!.effet,
    priorite: porteurs[0]!.priorite,
    regles: [...new Set(porteurs.map((c) => c.regle))],
  };
}

/** Résout les effets candidats d'une même clé (liste non vide). */
export function resoudreCle(
  cle: string,
  candidats: readonly CandidatEffet[],
): { applique: EffetApplique | null; conflit: ConflitModulation | null } {
  const tries = trierCandidats(candidats);
  const premier = tries[0]!;
  if (premier.effet.type === "recommandation_candidate") {
    return { applique: applique(cle, tries), conflit: null };
  }
  if (premier.effet.type === "relever_classe_risque") {
    const classe = classeRisqueMax(
      tries.map(
        (c) => (c.effet as Extract<EffetModulation, { type: "relever_classe_risque" }>).classe,
      ),
    );
    return {
      applique: applique(
        cle,
        tries.filter((c) => valeurEffet(c.effet) === classe),
      ),
      conflit: null,
    };
  }
  const valeurs = new Set(tries.map((c) => valeurEffet(c.effet)));
  if (valeurs.size === 1) return { applique: applique(cle, tries), conflit: null };
  const tete = tries.filter((c) => c.priorite === premier.priorite);
  const valeursTete = new Set(tete.map((c) => valeurEffet(c.effet)));
  if (valeursTete.size > 1) {
    return {
      applique: null,
      conflit: { cle, resolu: false, regleRetenue: null, candidats: tries },
    };
  }
  const retenue = valeurEffet(premier.effet);
  return {
    applique: applique(
      cle,
      tries.filter((c) => valeurEffet(c.effet) === retenue),
    ),
    conflit: { cle, resolu: true, regleRetenue: premier.regle, candidats: tries },
  };
}

export interface EtatModulation {
  /** Briques actives après modulation : (base ∪ activées) − retirées, triées. */
  readonly briquesActives: readonly string[];
  readonly briquesActivees: readonly string[];
  readonly briquesRetirees: readonly string[];
  readonly itemsActives: readonly string[];
  readonly itemsRetires: readonly string[];
  readonly ponderations: Readonly<Record<string, number>>;
  readonly seuils: Readonly<Record<string, number>>;
  readonly benchmarks: Readonly<Record<string, string>>;
  readonly gabarits: Readonly<Record<string, string>>;
  readonly formulations: Readonly<Record<string, string>>;
  readonly recommandationsCandidates: readonly string[];
  /** Classe relevée par cible ; l'appelant retient le maximum avec la classe de base. */
  readonly classesRisqueRelevees: Readonly<Record<string, ClasseRisque>>;
}

/** État résultant des effets appliqués (triés par clé). */
export function construireEtat(
  appliques: readonly EffetApplique[],
  briquesDeBase: readonly string[],
): EtatModulation {
  const listes = {
    briquesActivees: [] as string[],
    briquesRetirees: [] as string[],
    itemsActives: [] as string[],
    itemsRetires: [] as string[],
    recommandationsCandidates: [] as string[],
  };
  const tables = {
    ponderations: {} as Record<string, number>,
    seuils: {} as Record<string, number>,
    benchmarks: {} as Record<string, string>,
    gabarits: {} as Record<string, string>,
    formulations: {} as Record<string, string>,
    classesRisqueRelevees: {} as Record<string, ClasseRisque>,
  };
  for (const { effet } of appliques) {
    switch (effet.type) {
      case "activer_brique":
        listes.briquesActivees.push(effet.brique);
        break;
      case "retirer_brique":
        listes.briquesRetirees.push(effet.brique);
        break;
      case "activer_item":
        listes.itemsActives.push(effet.item);
        break;
      case "retirer_item":
        listes.itemsRetires.push(effet.item);
        break;
      case "ponderation":
        tables.ponderations[effet.cible] = effet.valeur;
        break;
      case "seuil":
        tables.seuils[effet.cible] = effet.valeur;
        break;
      case "benchmark":
        tables.benchmarks[effet.cible] = effet.choix;
        break;
      case "gabarit":
        tables.gabarits[effet.cible] = effet.choix;
        break;
      case "formulation":
        tables.formulations[effet.cible] = effet.choix;
        break;
      case "recommandation_candidate":
        listes.recommandationsCandidates.push(effet.recommandation);
        break;
      case "relever_classe_risque":
        tables.classesRisqueRelevees[effet.cible] = effet.classe;
        break;
    }
  }
  const retirees = new Set(listes.briquesRetirees);
  const actives = [...new Set([...briquesDeBase, ...listes.briquesActivees])]
    .filter((b) => !retirees.has(b))
    .sort(comparerCodes);
  return { briquesActives: actives, ...listes, ...tables };
}
