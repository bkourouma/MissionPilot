import { evaluerConditionAutomatisation } from "./conditions";
import { ErreurAutomatisation } from "./erreurs";
import {
  ACTIONS_PAR_AUTOMATISATION_MAX,
  type DefinitionPlanifiable,
  type PayloadEvenement,
} from "./types";

/*
 * Planification d'une exécution (AUT-02) : une automatisation se déclenche si le contenu de
 * l'événement satisfait sa condition ; ses actions sont alors planifiées dans l'ordre, chacune
 * avec une CLÉ D'IDEMPOTENCE déterministe (automatisation, événement, rang) : rejouer le même
 * événement ne planifie jamais deux fois la même action (index unique en base).
 */

export interface ActionPlanifiee<A> {
  readonly indice: number;
  readonly action: A;
  readonly cle: string;
}

export interface PlanExecution<A> {
  readonly declenchee: boolean;
  readonly actions: readonly ActionPlanifiee<A>[];
}

const IDENTIFIANT = /^[A-Za-z0-9_-]{1,64}$/;

/** Clé d'idempotence d'une action : `aut:<automatisation>:evt:<événement>:<rang>`. */
export function cleActionAutomatisation(
  automatisationId: string,
  evenementId: string,
  indice: number,
): string {
  if (!IDENTIFIANT.test(automatisationId) || !IDENTIFIANT.test(evenementId)) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Identifiant d'automatisation invalide.");
  }
  if (!Number.isInteger(indice) || indice < 0 || indice >= ACTIONS_PAR_AUTOMATISATION_MAX) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Rang d'action invalide.");
  }
  return `aut:${automatisationId}:evt:${evenementId}:${indice}`;
}

/** Évalue la condition et planifie les actions (aucune si la condition n'est pas remplie). */
export function planifierExecutionAutomatisation<A>(
  automatisationId: string,
  definition: DefinitionPlanifiable<A>,
  evenement: { readonly id: string; readonly payload: PayloadEvenement },
): PlanExecution<A> {
  if (
    definition.actions.length === 0 ||
    definition.actions.length > ACTIONS_PAR_AUTOMATISATION_MAX
  ) {
    throw new ErreurAutomatisation(
      "DEFINITION_INVALIDE",
      `Une automatisation porte de 1 à ${ACTIONS_PAR_AUTOMATISATION_MAX} actions.`,
    );
  }
  if (!evaluerConditionAutomatisation(definition.condition, evenement.payload)) {
    return { declenchee: false, actions: [] };
  }
  return {
    declenchee: true,
    actions: definition.actions.map((action, indice) => ({
      indice,
      action,
      cle: cleActionAutomatisation(automatisationId, evenement.id, indice),
    })),
  };
}
