import type { ContexteTenantDemo } from "../contexte.js";
import { semerIaCanauxQualite } from "./ia-canaux-qualite.js";
import { semerMissions } from "./missions.js";
import { semerNotationPlans } from "./notation-plans.js";
import { semerPortailCollab } from "./portail-collab.js";
import { semerRedressementDdAo } from "./redressement-dd-ao.js";

/*
 * Registre ORDONNÉ des phases de domaine du seed « Tenant démo », exécutées après le socle.
 *
 * Une phase = un fichier `phases/<nom>.ts` dont le lot de domaine est seul propriétaire. Les
 * lots ne modifient JAMAIS ce registre : les cinq phases y sont déjà inscrites (stubs au lot 1).
 *
 * L'ordre est celui des dépendances de données :
 *   1. missions               missions, temps, facturation, finance (les autres phases s'y accrochent)
 *   2. notation-plans         notation, plans stratégiques, KPI (clients et missions du socle)
 *   3. redressement-dd-ao     redressement, due diligence, appels d'offres
 *   4. ia-canaux-qualite      IA, canaux, automatisation, qualité, standard (lisent les missions)
 *   5. portail-collab         portail client et collaboration (partage des missions et documents)
 *
 * Chaque phase reçoit le contexte COMPLET du socle (sessions, identifiants, horloge, hasard) et
 * celui des phases précédentes n'est lisible que par les routes (rien n'est ajouté au contexte
 * par une phase). L'orchestrateur (../index.ts) saute une phase déjà marquée faite.
 */
export interface PhaseTenantDemo {
  /** Nom stable : sert de marqueur d'idempotence (journal d'audit) et d'option `--phase`. */
  nom: string;
  executer(ctx: ContexteTenantDemo): Promise<void>;
}

export const PHASES: readonly PhaseTenantDemo[] = [
  { nom: "missions", executer: semerMissions },
  { nom: "notation-plans", executer: semerNotationPlans },
  { nom: "redressement-dd-ao", executer: semerRedressementDdAo },
  { nom: "ia-canaux-qualite", executer: semerIaCanauxQualite },
  { nom: "portail-collab", executer: semerPortailCollab },
];
