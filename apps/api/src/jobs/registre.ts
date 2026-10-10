import type { Database, Db } from "../db/pool.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import {
  creerHandlerDetectionAutomatisation,
  TYPE_JOB_DETECTION_AUTOMATISATION,
} from "../automatisation/detection.js";
import { TYPE_JOB_EVENEMENT_AUTOMATISATION } from "../automatisation/evenements.js";
import {
  creerHandlerAgentAutomatisation,
  creerHandlerEvenementAutomatisation,
  TYPE_JOB_AGENT_AUTOMATISATION,
} from "../automatisation/execution.js";
import { loadConfig } from "../config.js";
import { creerHandlerRelances, TYPE_JOB_RELANCES } from "../finance/relances.js";
import { creerHandlerConservationIa, TYPE_JOB_CONSERVATION_IA } from "../ia/conservation.js";
import { creerHandlerIaGeneration, dependancesIaParDefaut } from "../ia/job.js";
import { creerHandlerSuiviKpi, TYPE_JOB_SUIVI_KPI } from "../kpi/suivi.js";
import {
  relanceQuestionnaire,
  TYPE_JOB_RELANCE_QUESTIONNAIRE,
} from "../questionnaires/relances.js";
import { creerHandlerPurgeRapports, TYPE_JOB_PURGE_RAPPORTS } from "../rapports/purge.js";
import { relanceSalleMission, TYPE_JOB_RELANCE_SALLE } from "../salle-mission/relances.js";
import { stockageDe } from "../stockage/index.js";
import { creerHandlerPurgeFichiers, TYPE_JOB_PURGE_FICHIERS } from "../stockage/purge.js";
import { rappelFeuilles, relanceFeuilles } from "../temps/rappels.js";

/** Contexte d'exécution d'un job : transaction ouverte dans le contexte RLS de son cabinet. */
export interface ContexteJob {
  db: Db;
  cabinetId: string;
  jobId: string;
  charge: Record<string, unknown>;
  /** Heure courante de l'horloge du worker (injectable en test). */
  maintenant: Date;
  /**
   * Base de l'application (fournie par le worker) : transactions COURTES
   * séparées de celle du job, visibles des autres connexions dès leur
   * validation (réservation du plafond IA, ia/job.ts).
   */
  database?: Database;
}

/**
 * Un handler s'exécute dans la transaction du job : s'il lève une erreur,
 * tout est annulé et le job est repris (ou passe en échec). Il renvoie les
 * notifications dont les e-mails partent après validation de la transaction.
 */
export type HandlerJob = (
  ctx: ContexteJob,
) => Promise<readonly (NotificationCreee | null)[] | void>;

export type RegistreJobs = ReadonlyMap<string, HandlerJob>;

// Définie dans un module neutre (jobs/erreurs.ts) : un handler inscrit ici
// l'importe de là, sans importation circulaire avec ce registre.
export { ErreurJobDefinitive } from "./erreurs.js";

export function creerRegistre(handlers: Record<string, HandlerJob>): RegistreJobs {
  for (const type of Object.keys(handlers)) {
    if (!/^[a-z_]{1,60}$/.test(type)) throw new Error(`Type de job refusé : ${type}`);
  }
  return new Map(Object.entries(handlers));
}

/**
 * Handlers de MissionPilot : rappels du vendredi et relances du lundi
 * (TPS-04), relances quotidiennes des factures échues (FIN-09), purge des
 * fichiers orphelins (SOC-05), générations IA, relances des questionnaires
 * (J+3 / J+7) et suivi quotidien des KPI. Un handler importe
 * `ErreurJobDefinitive` de jobs/erreurs.ts, jamais de ce module (pas
 * d'importation circulaire). Le stockage de la purge est celui de la
 * configuration de l'environnement ; server.ts le fournit explicitement
 * (`registreAvecStockage`).
 */
export const REGISTRE_JOBS: RegistreJobs = creerRegistre({
  rappel_feuilles: rappelFeuilles,
  relance_feuilles: relanceFeuilles,
  [TYPE_JOB_RELANCES]: creerHandlerRelances(),
  [TYPE_JOB_PURGE_FICHIERS]: creerHandlerPurgeFichiers(() => stockageDe(loadConfig())),
  [TYPE_JOB_PURGE_RAPPORTS]: creerHandlerPurgeRapports(() => stockageDe(loadConfig())), // rapports échus
  ia_generation: creerHandlerIaGeneration(dependancesIaParDefaut), // générations IA en file (ADR-003)
  [TYPE_JOB_CONSERVATION_IA]: creerHandlerConservationIa(), // anonymisation des textes IA échus
  [TYPE_JOB_RELANCE_QUESTIONNAIRE]: relanceQuestionnaire, // relances J+3 / J+7 (V2)
  [TYPE_JOB_SUIVI_KPI]: creerHandlerSuiviKpi(), // alertes et rappels des KPI (KPI-02, KPI-04)
  // Moteur d'automatisation (AUT-01 à AUT-06, ADR-006) : événements, appels d'agents, détection.
  [TYPE_JOB_EVENEMENT_AUTOMATISATION]: creerHandlerEvenementAutomatisation(),
  [TYPE_JOB_AGENT_AUTOMATISATION]: creerHandlerAgentAutomatisation(dependancesIaParDefaut),
  [TYPE_JOB_DETECTION_AUTOMATISATION]: creerHandlerDetectionAutomatisation(),
  [TYPE_JOB_RELANCE_SALLE]: relanceSalleMission, // relances J-3 / J+1 / J+7 de la salle de mission
});

/** Registre dont la purge des fichiers utilise ce stockage (configuration du serveur). */
export function registreAvecStockage(
  base: RegistreJobs,
  stockage: () => ReturnType<typeof stockageDe>,
): RegistreJobs {
  return creerRegistre({
    ...Object.fromEntries(base),
    [TYPE_JOB_PURGE_FICHIERS]: creerHandlerPurgeFichiers(stockage),
    [TYPE_JOB_PURGE_RAPPORTS]: creerHandlerPurgeRapports(stockage),
  });
}
