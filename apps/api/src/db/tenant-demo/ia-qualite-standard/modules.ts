import type { ModuleLot } from "./commun.js";
import { semerAgents } from "./agents.js";
import { semerAutomatisation } from "./automatisation.js";
import { semerAvancement } from "./avancement.js";
import { semerCopilote } from "./copilote.js";
import { semerIa } from "./ia.js";
import { semerQualite } from "./qualite.js";
import { semerRevuesFroides } from "./qualite-froide.js";
import { semerStandard } from "./standard.js";

/*
 * Modules de la phase « ia-qualite-standard », DANS L'ORDRE D'EXÉCUTION (les suivants peuvent
 * s'appuyer sur ce que les précédents ont semé). Chacun est idempotent.
 */
export const MODULES = {
  standard: semerStandard,
  ia: semerIa,
  agents: semerAgents,
  copilote: semerCopilote,
  automatisation: semerAutomatisation,
  avancement: semerAvancement,
  qualite: semerQualite,
} as const satisfies Record<string, ModuleLot>;

/*
 * Étapes à lancer APRÈS la clôture des 5 missions terminées (fin de la phase « gestion ») : la
 * revue à froide (QUA-05) exige des missions clôturées. Non exécutées par la phase
 * « ia-qualite-standard » ; la phase « gestion » appelle `semerRevuesFroides(ctx)`.
 */
export const MODULES_APRES_CLOTURE = {
  "revues-froides": semerRevuesFroides,
} as const satisfies Record<string, ModuleLot>;
