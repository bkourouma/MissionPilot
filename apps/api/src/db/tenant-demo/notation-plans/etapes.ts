import type { ContexteTenantDemo } from "../contexte.js";
import { semerKpi } from "./kpi.js";
import { semerNotationReferentiels } from "./notation-referentiels.js";
import { semerNotations } from "./notations.js";
import { semerNotationsComplement } from "./notations-complement.js";
import { semerPlansAvances } from "./plans-avances.js";
import { semerPlansCoeur } from "./plans-coeur.js";
import { semerQuestionnaires } from "./questionnaires.js";

/*
 * Étapes de la phase « notation-plans », dans l'ordre des dépendances de données :
 *   1. notation-referentiels  grilles validées, banque d'items, paramètres, initiatives types
 *   2. questionnaires         modèles, versions, envois, réponses, relances, historique IA
 *   3. kpi                    définitions, mesures sur 24 mois, cibles, alertes, arbres, revues, actions
 *   4. notations              notations des missions 2 et 9, versions, publication, calibrage, plans d'action
 *   5. plans-coeur            plans stratégiques (missions 1, 5, 6, 10), éléments, modèles, cascade, portefeuille
 *   5b. notations-complement  notations publiées complémentaires (classes A et E) et lien au diagnostic des plans
 *   6. plans-avances          ateliers (portail), Monte-Carlo, réalisés, reprévisions, plan vivant
 * Chaque étape est idempotente (clé naturelle) : relancée, elle ne duplique rien.
 */
export interface EtapeNotationPlans {
  nom: string;
  executer(ctx: ContexteTenantDemo): Promise<void>;
}

export const ETAPES: readonly EtapeNotationPlans[] = [
  { nom: "notation-referentiels", executer: semerNotationReferentiels },
  { nom: "questionnaires", executer: semerQuestionnaires },
  { nom: "kpi", executer: semerKpi },
  { nom: "notations", executer: semerNotations },
  { nom: "plans-coeur", executer: semerPlansCoeur },
  { nom: "notations-complement", executer: semerNotationsComplement },
  { nom: "plans-avances", executer: semerPlansAvances },
];

/** Exécute les étapes (toutes, ou celles de `seulement`) dans l'ordre. */
export async function executerEtapes(
  ctx: ContexteTenantDemo,
  seulement?: readonly string[],
): Promise<void> {
  for (const etape of ETAPES) {
    if (seulement && !seulement.includes(etape.nom)) continue;
    ctx.journal(`  notation-plans / ${etape.nom}…`);
    await etape.executer(ctx);
  }
}
