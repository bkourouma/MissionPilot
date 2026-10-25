import type { ModuleLot } from "./commun.js";
import { semerAgents } from "./agents.js";
import { semerAutomatisation } from "./automatisation.js";
import { semerAvancement } from "./avancement.js";
import { semerCopilote } from "./copilote.js";
import { semerIa } from "./ia.js";
import { semerQualite } from "./qualite.js";
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
 * La revue à froid (QUA-05) n'est PAS dans cette liste : elle exige des missions clôturées. La
 * phase « gestion » appelle `semerRevuesFroides(ctx)` (qualite-froide.ts) après la clôture finale.
 */
