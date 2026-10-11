import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import type { HandlerJob } from "../jobs/registre.js";

/*
 * Conservation limitée des propositions d'actions du copilote (migration 0274). `parametres` (titre
 * de tâche, assigné, mission) et `resume` d'une proposition TERMINÉE (confirmée, annulée, expirée,
 * refusée) sont anonymisés au bout de `CONSERVATION_ACTIONS_COPILOTE_JOURS` jours ; une proposition
 * « proposee » échue est d'abord marquée « expiree ». Le reste de la trace est conservé.
 *
 * Job « copilote_purge », planifié au plus une fois par jour et par cabinet (clé
 * `copilote_purge:AAAA-MM-JJ`, `planifier_purge_copilote`) pour les seuls cabinets qui ont une
 * proposition à traiter. L'anonymisation passe par `anonymiser_copilote_actions` (SECURITY DEFINER,
 * limitée au cabinet du contexte) : le rôle applicatif n'a aucun droit de modifier ces textes.
 * L'horloge est celle du worker (injectable en test).
 */

export const TYPE_JOB_COPILOTE_PURGE = "copilote_purge";
/** Durée de conservation avant anonymisation : 30 jours (valeur PROPOSÉE, à valider). */
export const CONSERVATION_ACTIONS_COPILOTE_JOURS = 30;
/** Heure (UTC) de la purge quotidienne, hors des heures de travail de la zone UEMOA. */
export const HEURE_PURGE_COPILOTE_UTC = "02:30:00";
const LOT_PURGE = 1000;
const LOTS_MAX = 50;

/** Purge du jour de `maintenant` : clé unique par cabinet et par jour. */
export function planificationPurgeCopilote(maintenant: Date): { cle: string; executeA: Date } {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `copilote_purge:${jour}`,
    executeA: new Date(`${jour}T${HEURE_PURGE_COPILOTE_UTC}Z`),
  };
}

/** Planifie la purge du jour (hors contexte de cabinet) ; renvoie le nombre de jobs créés. */
export async function planifierPurgeCopilote(db: Db, maintenant: Date): Promise<number> {
  const p = planificationPurgeCopilote(maintenant);
  const r = await db.query("SELECT planifier_purge_copilote($1, $2, $3, $4) AS n", [
    p.cle,
    p.executeA,
    maintenant,
    CONSERVATION_ACTIONS_COPILOTE_JOURS,
  ]);
  return r.rows[0].n as number;
}

export function creerHandlerCopilotePurge(): HandlerJob {
  return async ({ db, cabinetId, maintenant }) => {
    let total = 0;
    for (let i = 0; i < LOTS_MAX; i++) {
      const r = await db.query("SELECT anonymiser_copilote_actions($1, $2, $3) AS n", [
        maintenant,
        CONSERVATION_ACTIONS_COPILOTE_JOURS,
        LOT_PURGE,
      ]);
      const n = r.rows[0].n as number;
      total += n;
      if (n < LOT_PURGE) break;
    }
    if (total > 0) {
      await journaliser(db, {
        cabinetId,
        utilisateurId: null,
        action: "copilote.purge",
        entite: "copilote_action",
        details: {
          propositions: total,
          conservation_jours: CONSERVATION_ACTIONS_COPILOTE_JOURS,
          a: maintenant.toISOString(),
        },
      });
    }
  };
}
