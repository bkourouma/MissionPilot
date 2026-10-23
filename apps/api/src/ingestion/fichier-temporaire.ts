import type { Readable } from "node:stream";
import { journaliser } from "../audit.js";
import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import type { DocumentIngestion } from "./documents.js";

/*
 * Objet de stockage TEMPORAIRE d'un document ingéré (ADR-009, décision 6) : le document est analysé puis son
 * objet est effacé. Deux temps, dans cet ordre :
 *
 * 1. `marquerFichierSupprime` (transaction du job d'extraction) : ligne `fichiers_suppressions` (motif
 *    `retire`, supprime_par = auteur), comme l'import Excel qui ne conserve rien ;
 * 2. `effacerObjet` / `supprimerObjet` : suppression PHYSIQUE de l'objet, SEULEMENT une fois les pages durables (début du job
 *    de structuration, ou échec définitif de l'extraction), idempotente ; `fichier_id` repasse alors à NULL.
 *    Un échec du stockage laisse `fichier_id` renseigné (l'effacement sera retenté à la relance) et
 *    n'interrompt pas la structuration, qui n'a plus besoin du fichier.
 */

export async function marquerFichierSupprime(db: Db, doc: DocumentIngestion): Promise<void> {
  if (!doc.fichier_id) return;
  await db.query(
    `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
     SELECT $1, $2, 'retire', $3
     WHERE NOT EXISTS (SELECT 1 FROM fichiers_suppressions WHERE fichier_id = $2)`,
    [doc.cabinet_id, doc.fichier_id, doc.cree_par],
  );
}

/**
 * Efface physiquement l'objet de stockage du document (idempotent, sans erreur s'il est déjà absent). Renvoie
 * vrai quand l'objet n'existe plus, faux si le stockage a échoué (l'appelant garde alors `fichier_id`).
 */
export async function supprimerObjet(
  db: Db,
  config: Pick<Config, "NODE_ENV" | "STORAGE_DIR" | "STORAGE_DRIVER">,
  doc: DocumentIngestion,
): Promise<boolean> {
  if (!doc.fichier_id) return true;
  const r = await db.query("SELECT cle_stockage FROM fichiers WHERE id = $1", [doc.fichier_id]);
  const cle = r.rows[0]?.cle_stockage as string | undefined;
  if (!cle) return true;
  try {
    await stockageDe(config).supprimer(doc.cabinet_id, cle);
    return true;
  } catch {
    // Journal sans contenu : l'objet reste à reprendre (voir `effacerObjetsMarques`).
    await journaliser(db, {
      cabinetId: doc.cabinet_id,
      utilisateurId: doc.cree_par,
      action: "ingestion.effacement_echoue",
      entite: "ingestion_document",
      entiteId: doc.id,
      details: { usage: doc.usage, fichier_id: doc.fichier_id },
    });
    return false;
  }
}

/**
 * Reprise des objets dont l'effacement a échoué (M1) : une fois `fichiers_suppressions` posée, la purge
 * des orphelins ne les reprend plus. Efface (idempotent) les objets des fichiers marqués `retire` du cabinet
 * courant (`lot` au plus, les plus récemment marqués d'abord) et renvoie le nombre d'objets effacés et d'échecs.
 * Un objet déjà absent n'est ni effacé ni compté. Branchée au job `ingestion_maintenance` (maintenance.ts).
 */
export async function effacerObjetsMarques(
  db: Db,
  config: Pick<Config, "NODE_ENV" | "STORAGE_DIR" | "STORAGE_DRIVER">,
  cabinetId: string,
  lot = 200,
): Promise<{ effaces: number; echecs: number }> {
  const r = await db.query(
    `SELECT f.cle_stockage FROM fichiers f
     JOIN fichiers_suppressions s ON s.fichier_id = f.id
     WHERE f.cabinet_id = $1 AND s.motif = 'retire' ORDER BY s.supprime_le DESC LIMIT $2`,
    [cabinetId, lot],
  );
  const stockage = stockageDe(config);
  let effaces = 0;
  let echecs = 0;
  for (const ligne of r.rows) {
    const cle = ligne.cle_stockage as string;
    try {
      // Présence : ouverture sans lire le flux ; seuls les objets encore présents sont effacés et comptés.
      try {
        (await stockage.lire(cabinetId, cle)).destroy();
      } catch (e) {
        if (e instanceof FichierAbsent) continue;
        throw e;
      }
      await stockage.supprimer(cabinetId, cle);
      effaces += 1;
    } catch {
      echecs += 1;
    }
  }
  return { effaces, echecs };
}

/** Efface l'objet puis libère `fichier_id` (document encore en cours : le déclencheur refuse un document terminé). */
export async function effacerObjet(
  db: Db,
  config: Pick<Config, "NODE_ENV" | "STORAGE_DIR" | "STORAGE_DRIVER">,
  doc: DocumentIngestion,
): Promise<void> {
  if (!doc.fichier_id) return;
  if (await supprimerObjet(db, config, doc)) {
    await db.query("UPDATE ingestion_documents SET fichier_id = NULL WHERE id = $1", [doc.id]);
  }
}

/** Contenu du flux, au plus `max` octets (au-delà : null, le fichier ne correspond plus à l'enregistrement). */
export async function lireBorne(flux: Readable, max: number): Promise<Buffer | null> {
  const morceaux: Buffer[] = [];
  let total = 0;
  for await (const m of flux) {
    const b = Buffer.isBuffer(m) ? m : Buffer.from(m as Uint8Array);
    total += b.length;
    if (total > max) {
      flux.destroy();
      return null;
    }
    morceaux.push(b);
  }
  return Buffer.concat(morceaux);
}
