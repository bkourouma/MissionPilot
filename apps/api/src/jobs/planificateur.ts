import { ajouterJours, lundiDeLaSemaine } from "@missionpilot/engines";
import type { Database } from "../db/pool.js";

/*
 * Planification récurrente (TPS-04), pour tous les cabinets :
 * - rappel de saisie le vendredi de la semaine courante à 16 h (UTC) ;
 * - relance des feuilles incomplètes le lundi suivant à 8 h (UTC).
 * Heures en UTC : la zone UEMOA est à UTC (Côte d'Ivoire, Sénégal…) ou UTC+1
 * (Bénin, Niger). La clé d'unicité `type:semaine` garantit qu'un rappel
 * n'est planifié qu'une fois par cabinet et par semaine, quel que soit le
 * nombre de passages du planificateur ou de workers.
 */

export const HEURE_RAPPEL_UTC = "16:00:00";
export const HEURE_RELANCE_UTC = "08:00:00";

export interface Planification {
  type: "rappel_feuilles" | "relance_feuilles";
  cle: string;
  executeA: Date;
  semaine: string;
}

/** Tâches récurrentes de la semaine de `maintenant`. */
export function planificationsDeLaSemaine(maintenant: Date): Planification[] {
  const lundi = lundiDeLaSemaine(maintenant.toISOString().slice(0, 10));
  return [
    {
      type: "rappel_feuilles",
      cle: `rappel_feuilles:${lundi}`,
      executeA: new Date(`${ajouterJours(lundi, 4)}T${HEURE_RAPPEL_UTC}Z`),
      semaine: lundi,
    },
    {
      type: "relance_feuilles",
      cle: `relance_feuilles:${lundi}`,
      executeA: new Date(`${ajouterJours(lundi, 7)}T${HEURE_RELANCE_UTC}Z`),
      semaine: lundi,
    },
  ];
}

/** Insère les tâches récurrentes manquantes ; renvoie le nombre de jobs créés. */
export async function planifierRecurrents(database: Database, maintenant: Date): Promise<number> {
  return database.withoutTenant(async (db) => {
    let total = 0;
    for (const p of planificationsDeLaSemaine(maintenant)) {
      const r = await db.query("SELECT planifier_job_cabinets($1, $2, $3, $4) AS n", [
        p.type,
        p.cle,
        p.executeA,
        JSON.stringify({ semaine: p.semaine }),
      ]);
      total += r.rows[0].n as number;
    }
    return total;
  });
}
