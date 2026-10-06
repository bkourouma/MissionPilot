import { journaliser } from "../audit.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { StockageFichiers } from "./stockage.js";

/*
 * Purge des fichiers orphelins (téléversés, jamais rattachés à un document
 * ni à un débours) de plus de 24 h. Job « purge_fichiers_orphelins »,
 * planifié par cabinet et par heure (planificateur.ts, clé unique). Dans la
 * transaction du job : marquage `fichiers_suppressions` (motif « orphelin »),
 * effacement des objets de stockage, une ligne d'audit. Si la transaction
 * échoue après l'effacement, les fichiers restent non marqués mais sans
 * objet : leur téléchargement répond 404 et la purge suivante les marque.
 * L'horloge est celle du worker (injectable en test).
 */

export const TYPE_JOB_PURGE_FICHIERS = "purge_fichiers_orphelins";
export const DELAI_ORPHELIN_MS = 24 * 60 * 60 * 1000;
const LOT_PURGE = 1000;

export function creerHandlerPurgeFichiers(stockage: () => StockageFichiers): HandlerJob {
  return async ({ db, cabinetId, maintenant }) => {
    const seuil = new Date(maintenant.getTime() - DELAI_ORPHELIN_MS);
    const r = await db.query(
      `WITH cibles AS (
         SELECT f.id, f.cle_stockage FROM fichiers f
         WHERE f.cree_le < $1 AND fichier_orphelin(f.id)
         ORDER BY f.cree_le, f.id LIMIT $2),
       marques AS (
         INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif)
         SELECT $3, id, 'orphelin' FROM cibles RETURNING fichier_id)
       SELECT c.cle_stockage FROM cibles c JOIN marques m ON m.fichier_id = c.id`,
      [seuil, LOT_PURGE, cabinetId],
    );
    const s = stockage();
    for (const ligne of r.rows) await s.supprimer(cabinetId, ligne.cle_stockage as string);
    if (r.rows.length > 0) {
      await journaliser(db, {
        cabinetId,
        utilisateurId: null,
        action: "purge_orphelins",
        entite: "fichier",
        details: { nombre: r.rows.length, seuil: seuil.toISOString() },
      });
    }
  };
}
