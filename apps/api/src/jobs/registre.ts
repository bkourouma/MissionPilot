import type { Db } from "../db/pool.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { rappelFeuilles, relanceFeuilles } from "../temps/rappels.js";

/** Contexte d'exécution d'un job : transaction ouverte dans le contexte RLS de son cabinet. */
export interface ContexteJob {
  db: Db;
  cabinetId: string;
  jobId: string;
  charge: Record<string, unknown>;
  /** Heure courante de l'horloge du worker (injectable en test). */
  maintenant: Date;
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

/** Erreur qui ne mérite pas de nouvelle tentative (type inconnu, charge invalide…). */
export class ErreurJobDefinitive extends Error {}

export function creerRegistre(handlers: Record<string, HandlerJob>): RegistreJobs {
  for (const type of Object.keys(handlers)) {
    if (!/^[a-z_]{1,60}$/.test(type)) throw new Error(`Type de job refusé : ${type}`);
  }
  return new Map(Object.entries(handlers));
}

/** Handlers de MissionPilot : rappels du vendredi et relances du lundi (TPS-04). */
export const REGISTRE_JOBS: RegistreJobs = creerRegistre({
  rappel_feuilles: rappelFeuilles,
  relance_feuilles: relanceFeuilles,
});
