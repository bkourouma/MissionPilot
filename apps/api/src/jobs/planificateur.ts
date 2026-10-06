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
 * - Relance des factures échues (FIN-09) chaque jour à 18 h (UTC), pour les
 *   seuls cabinets ayant une facture émise échue ; clé `relances_factures:jour`.
 */

export const HEURE_RAPPEL_UTC = "16:00:00";
export const HEURE_RELANCE_UTC = "08:00:00";
/**
 * Relances des factures échues (FIN-09) : chaque jour à 18 h UTC, en fin de
 * journée de travail de la zone UEMOA (valeur à valider par le métier).
 */
export const HEURE_RELANCES_FACTURES_UTC = "18:00:00";

export interface Planification {
  type: "rappel_feuilles" | "relance_feuilles";
  cle: string;
  executeA: Date;
  semaine: string;
}

/** Relance des factures du jour de `maintenant` : clé unique par cabinet et par jour. */
export function planificationDuJour(maintenant: Date): {
  cle: string;
  executeA: Date;
  jour: string;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `relances_factures:${jour}`,
    executeA: new Date(`${jour}T${HEURE_RELANCES_FACTURES_UTC}Z`),
    jour,
  };
}

/**
 * Purge des fichiers orphelins (SOC-05) : au plus une par heure et par
 * cabinet (clé `purge_fichiers:AAAA-MM-JJTHH`), pour les seuls cabinets ayant
 * un fichier non rattaché de plus de 24 h.
 */
export function planificationPurgeFichiers(maintenant: Date): {
  cle: string;
  executeA: Date;
  seuil: Date;
} {
  return {
    cle: `purge_fichiers:${maintenant.toISOString().slice(0, 13)}`,
    executeA: maintenant,
    seuil: new Date(maintenant.getTime() - 24 * 60 * 60 * 1000),
  };
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
    // Relances de factures : seulement les cabinets ayant une facture émise échue.
    const j = planificationDuJour(maintenant);
    const r = await db.query("SELECT planifier_relances_factures($1, $2, $3) AS n", [
      j.cle,
      j.executeA,
      j.jour,
    ]);
    total += r.rows[0].n as number;
    const p = planificationPurgeFichiers(maintenant);
    const purge = await db.query("SELECT planifier_purge_fichiers($1, $2, $3) AS n", [
      p.cle,
      p.executeA,
      p.seuil,
    ]);
    total += purge.rows[0].n as number;
    return total;
  });
}
