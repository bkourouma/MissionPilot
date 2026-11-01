import type { Db } from "../db/pool.js";

/*
 * Activité de démonstration automatique (job « activite_demo », DECISIONS « Activité de
 * démonstration automatique », 2026-11-01) : planification MENSUELLE.
 *
 * - Une tâche par cabinet et par MOIS, le 1er à 4 h (UTC), clé `activite_demo:AAAA-MM`, pour les
 *   seuls cabinets de démonstration actifs qui ont un collaborateur interne saisissant et une
 *   mission en vol (fonction SECURITY DEFINER étroite `planifier_activite_demo`, migration 0584).
 *   Planifiée en retard (worker arrêté le 1er), l'heure passée la fait partir au premier cycle ;
 *   un mois entier manqué n'est pas rattrapé (la clé est celle du mois courant).
 * - La tâche mensuelle met elle-même en file ses tâches de SUITE, une par lundi restant du mois,
 *   à 5 h (UTC), clé `activite_demo:AAAA-MM:AAAA-MM-JJ` (activite-demo/job.ts) : cette fonction ne
 *   les planifie pas.
 * - Activation (DT14) : l'appelant décide (option `activiteDemo` du worker, fausse par défaut,
 *   posée par server.ts depuis DEMO_ACTIVITE_AUTO) ; inactive, aucune requête n'est envoyée. Le
 *   handler revérifie l'activation, `est_demo` et `actif` à chaque exécution.
 */

export const TYPE_JOB_ACTIVITE_DEMO = "activite_demo";
/** Heure de la tâche mensuelle (UTC), le 1er du mois, avant la journée de travail UEMOA. */
export const HEURE_ACTIVITE_DEMO_UTC = "04:00:00";
/** Heure des tâches de suite (UTC), chaque lundi du mois. */
export const HEURE_SUITE_ACTIVITE_DEMO_UTC = "05:00:00";

/** Clé de la tâche mensuelle : une par cabinet et par mois (`jobs_cle_uniq`). */
export const cleMensuelleActiviteDemo = (mois: string): string =>
  `${TYPE_JOB_ACTIVITE_DEMO}:${mois}`;

/** Clé d'une tâche de suite : une par cabinet, mois et lundi. */
export const cleSuiteActiviteDemo = (mois: string, lundi: string): string =>
  `${TYPE_JOB_ACTIVITE_DEMO}:${mois}:${lundi}`;

/** Planification du mois de `maintenant` (UTC) : clé, heure d'exécution le 1er et premier du mois. */
export function planificationActiviteDemo(maintenant: Date): {
  cle: string;
  executeA: Date;
  mois: string;
  premier: string;
} {
  const mois = maintenant.toISOString().slice(0, 7);
  const premier = `${mois}-01`;
  return {
    cle: cleMensuelleActiviteDemo(mois),
    executeA: new Date(`${premier}T${HEURE_ACTIVITE_DEMO_UTC}Z`),
    mois,
    premier,
  };
}

/**
 * Planifie la tâche du mois pour les cabinets éligibles ; renvoie le nombre de tâches créées.
 * Inactive (`actif` faux) : 0, sans aucune requête. Appelée par le planificateur récurrent
 * (jobs/planificateur.ts) hors contexte de cabinet.
 */
export async function planifierActiviteDemo(
  db: Db,
  maintenant: Date,
  actif: boolean,
): Promise<number> {
  if (!actif) return 0;
  const p = planificationActiviteDemo(maintenant);
  const r = await db.query("SELECT planifier_activite_demo($1, $2, $3::date) AS n", [
    p.cle,
    p.executeA,
    p.premier,
  ]);
  return r.rows[0].n as number;
}
