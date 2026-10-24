import type { ContexteTenantDemo } from "../contexte.js";
import { semerAppelsOffresCanaux } from "./appels-offres-canaux.js";
import { semerGestion } from "./gestion.js";
import { semerIaQualiteStandard } from "./ia-qualite-standard.js";
import { semerMissions } from "./missions.js";
import { semerNotationPlans } from "./notation-plans.js";
import { semerRedressementDd } from "./redressement-dd.js";

/*
 * Registre ORDONNÉ des phases de domaine du seed « Tenant démo », exécutées après le socle.
 *
 * Une phase = un fichier `phases/<nom>.ts` dont le lot de domaine est seul propriétaire. Les
 * lots ne modifient JAMAIS ce registre : les six phases y sont déjà inscrites (stubs au lot 1).
 *
 * L'ordre est celui des dépendances de données :
 *   1. missions               missions (les autres phases s'y accrochent)
 *   2. notation-plans         notation, plans stratégiques, KPI (clients et missions du socle)
 *   3. redressement-dd        redressement et due diligence
 *   4. appels-offres-canaux   appels d'offres, canaux et automatisation
 *   5. ia-qualite-standard    IA, qualité et standard (lisent les missions)
 *   6. gestion                temps, facturation, rapports, salle de mission, ingestion, portail et collaboration
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
  { nom: "redressement-dd", executer: semerRedressementDd },
  { nom: "appels-offres-canaux", executer: semerAppelsOffresCanaux },
  { nom: "ia-qualite-standard", executer: semerIaQualiteStandard },
  { nom: "gestion", executer: semerGestion },
];
