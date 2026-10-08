import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { StockageFichiers } from "../stockage/stockage.js";
import { lireParametresRapports } from "./parametres.js";

/*
 * Purge des rapports générés au-delà de la durée de conservation du cabinet
 * (rapports/parametres.ts, migration 0132). Job « purge_rapports », planifié
 * au plus une fois par jour et par cabinet (clé `purge_rapports:AAAA-MM-JJ`)
 * pour les seuls cabinets qui ont un rapport à purger
 * (`planifier_purge_rapports`, SECURITY DEFINER).
 *
 * Dans la transaction du job (contexte RLS du cabinet) : marquage
 * `fichiers_suppressions` (motif « conservation ») d'au plus LOT_PURGE
 * fichiers, effacement des objets de stockage, une ligne d'audit. La ligne
 * `rapports_mission` reste (ajout seul) : le rapport sort des listes et son
 * téléchargement répond 404. Si la transaction échoue après l'effacement,
 * les fichiers restent non marqués mais sans objet (404) et la purge
 * suivante les marque. Au-delà du lot, la purge du lendemain continue.
 * L'horloge est celle du worker (injectable en test).
 */

export const TYPE_JOB_PURGE_RAPPORTS = "purge_rapports";
/** Heure (UTC) de la purge quotidienne, hors des heures de travail de la zone UEMOA. */
export const HEURE_PURGE_RAPPORTS_UTC = "02:00:00";
export const LOT_PURGE_RAPPORTS = 500;

/** Purge du jour de `maintenant` : clé unique par cabinet et par jour. */
export function planificationPurgeRapports(maintenant: Date): { cle: string; executeA: Date } {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `purge_rapports:${jour}`,
    executeA: new Date(`${jour}T${HEURE_PURGE_RAPPORTS_UTC}Z`),
  };
}

/** Planifie la purge du jour (hors contexte de cabinet) ; renvoie le nombre de jobs créés. */
export async function planifierPurgeRapports(db: Db, maintenant: Date): Promise<number> {
  const p = planificationPurgeRapports(maintenant);
  const r = await db.query("SELECT planifier_purge_rapports($1, $2, $3) AS n", [
    p.cle,
    p.executeA,
    maintenant,
  ]);
  return r.rows[0].n as number;
}

export function creerHandlerPurgeRapports(stockage: () => StockageFichiers): HandlerJob {
  return async ({ db, cabinetId, maintenant }) => {
    const { conservation_jours: jours } = await lireParametresRapports(db);
    const r = await db.query(
      `WITH cibles AS (
         SELECT r.id, f.id AS fichier_id, f.cle_stockage
         FROM rapports_mission r JOIN fichiers f ON f.id = r.fichier_id
         WHERE r.genere_le < $1::timestamptz - make_interval(days => $2)
           AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
         ORDER BY r.genere_le, r.id LIMIT $3),
       marques AS (
         INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif)
         SELECT $4, fichier_id, 'conservation' FROM cibles RETURNING fichier_id)
       SELECT c.id, c.cle_stockage FROM cibles c JOIN marques m ON m.fichier_id = c.fichier_id`,
      [maintenant, jours, LOT_PURGE_RAPPORTS, cabinetId],
    );
    const s = stockage();
    for (const ligne of r.rows) await s.supprimer(cabinetId, ligne.cle_stockage as string);
    if (r.rows.length > 0) {
      await journaliser(db, {
        cabinetId,
        utilisateurId: null,
        action: "purge_rapports",
        entite: "rapport",
        details: {
          nombre: r.rows.length,
          conservation_jours: jours,
          rapports: r.rows.map((l) => l.id as string),
        },
      });
    }
  };
}
