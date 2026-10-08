import { garderActionAutomatisation } from "./garde";
import { planifierExecutionAutomatisation } from "./planification";
import {
  REFUS_GARDE_AUTOMATISATION,
  type ContexteGarde,
  type DefinitionPlanifiable,
  type MetaAction,
  type PayloadEvenement,
  type RefusGardeAutomatisation,
} from "./types";

/*
 * Simulation d'une automatisation sur des événements PASSÉS (AUT-04) : pour chaque
 * événement, la condition est évaluée et chaque action planifiée passe la garde, exactement
 * comme à l'exécution réelle, sans AUCUN effet. Le résultat dit combien de fois
 * l'automatisation se serait déclenchée, quelles actions seraient parties et pourquoi les
 * autres auraient été refusées. Ordre des événements conservé.
 */

export interface EvenementSimule {
  readonly id: string;
  readonly cree_le: string;
  readonly payload: PayloadEvenement;
}

export interface ActionSimulee {
  readonly indice: number;
  readonly type: string;
  readonly autorisee: boolean;
  readonly refus: readonly RefusGardeAutomatisation[];
}

export interface DetailSimulation {
  readonly evenement_id: string;
  readonly cree_le: string;
  readonly declenchee: boolean;
  readonly actions: readonly ActionSimulee[];
}

export interface ResultatSimulation {
  readonly evenements: number;
  readonly declenchements: number;
  readonly actions_prevues: number;
  readonly actions_autorisees: number;
  readonly actions_refusees: number;
  /** Nombre d'actions refusées par raison (une action peut porter plusieurs raisons). */
  readonly refus: Readonly<Record<RefusGardeAutomatisation, number>>;
  readonly details: readonly DetailSimulation[];
}

export interface OptionsSimulation<A extends { readonly type: string }> {
  readonly metaDe: (action: A) => MetaAction;
  readonly contexteDe: (evenement: EvenementSimule, action: A) => ContexteGarde;
}

export function simulerAutomatisation<A extends { readonly type: string }>(
  definition: DefinitionPlanifiable<A>,
  evenements: readonly EvenementSimule[],
  options: OptionsSimulation<A>,
): ResultatSimulation {
  const refus = Object.fromEntries(REFUS_GARDE_AUTOMATISATION.map((r) => [r, 0])) as Record<
    RefusGardeAutomatisation,
    number
  >;
  let declenchements = 0;
  let prevues = 0;
  let autorisees = 0;
  const details: DetailSimulation[] = [];
  for (const e of evenements) {
    const plan = planifierExecutionAutomatisation("simulation", definition, e);
    if (plan.declenchee) declenchements += 1;
    const actions: ActionSimulee[] = plan.actions.map((p) => {
      const d = garderActionAutomatisation(
        options.metaDe(p.action),
        options.contexteDe(e, p.action),
      );
      prevues += 1;
      if (d.autorisee) autorisees += 1;
      for (const r of d.refus) refus[r] += 1;
      return { indice: p.indice, type: p.action.type, autorisee: d.autorisee, refus: d.refus };
    });
    details.push({ evenement_id: e.id, cree_le: e.cree_le, declenchee: plan.declenchee, actions });
  }
  return {
    evenements: evenements.length,
    declenchements,
    actions_prevues: prevues,
    actions_autorisees: autorisees,
    actions_refusees: prevues - autorisees,
    refus,
    details,
  };
}
