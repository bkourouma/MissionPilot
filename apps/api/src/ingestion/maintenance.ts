import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { DependancesIngestion } from "./fabrique.js";
import { effacerObjetsMarques } from "./fichier-temporaire.js";

/*
 * Maintenance quotidienne de l'ingestion de documents (ADR-009, décision 6) : UNE exécution par cabinet et par
 * jour (03:45 UTC, clé `ingestion_maintenance:AAAA-MM-JJ`).
 *
 * 1. Reprise des effacements d'objets temporaires échoués (`effacerObjetsMarques`, 200 objets au plus).
 * 2. Purge du texte des pages (décision de l'utilisateur du 2026-10-22) : conservé jusqu'à la validation de
 *    l'extraction + 90 jours, puis purgé ; l'état financier validé et le brouillon validé restent. Règle exacte dans
 *    la migration 0524 (`purger_textes_ingestion`) : document terminal, aucun brouillon ouvert, aucun état en revue,
 *    90 jours après la dernière décision (ou la fin du traitement s'il n'y a rien à décider).
 *
 * Le journal d'audit ne contient que des compteurs.
 */

export const TYPE_JOB_INGESTION_MAINTENANCE = "ingestion_maintenance";
export const HEURE_MAINTENANCE_INGESTION_UTC = "03:45:00";
/** Durée de conservation du texte après la décision (décision du 2026-10-22 ; bornes SQL : 90 à 3650 jours). */
export const CONSERVATION_TEXTE_JOURS = 90;
export const LOT_PURGE_TEXTES = 1000;
export const LOT_EFFACEMENTS = 200;

const chargeSchema = z.object({ jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export interface BilanMaintenanceIngestion {
  objets_effaces: number;
  effacements_echoues: number;
  documents_purges: number;
  pages_purgees: number;
}

const compterPages = async (db: Db, cabinetId: string): Promise<number> =>
  (
    await db.query("SELECT count(*)::int AS n FROM ingestion_pages WHERE cabinet_id = $1", [
      cabinetId,
    ])
  ).rows[0].n as number;

/** Applique la maintenance dans la transaction du cabinet (contexte RLS posé par l'appelant). */
export async function maintenirIngestion(
  db: Db,
  config: DependancesIngestion["config"],
  cabinetId: string,
  maintenant: Date,
): Promise<BilanMaintenanceIngestion> {
  const efface = await effacerObjetsMarques(db, config, cabinetId, LOT_EFFACEMENTS);
  const avant = await compterPages(db, cabinetId);
  const purges = await db.query("SELECT purger_textes_ingestion($1, $2, $3) AS n", [
    maintenant,
    CONSERVATION_TEXTE_JOURS,
    LOT_PURGE_TEXTES,
  ]);
  const bilan: BilanMaintenanceIngestion = {
    objets_effaces: efface.effaces,
    effacements_echoues: efface.echecs,
    documents_purges: purges.rows[0].n as number,
    pages_purgees: avant - (await compterPages(db, cabinetId)),
  };
  if (bilan.objets_effaces + bilan.effacements_echoues + bilan.documents_purges > 0) {
    await journaliser(db, {
      cabinetId,
      utilisateurId: null,
      action: "ingestion.maintenance",
      entite: "ingestion_document",
      details: { ...bilan, conservation_jours: CONSERVATION_TEXTE_JOURS },
    });
  }
  return bilan;
}

export function creerHandlerIngestionMaintenance(
  dependances: () => DependancesIngestion,
): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success)
      throw new ErreurJobDefinitive("Charge de maintenance de l'ingestion invalide.");
    const { config } = dependances();
    await maintenirIngestion(ctx.db, config, ctx.cabinetId, ctx.maintenant);
    return [];
  };
}

/** Planification quotidienne : fonction étroite `planifier_ingestion_maintenance` (03:45 UTC). */
export async function planifierIngestionMaintenance(db: Db, maintenant: Date): Promise<number> {
  const jour = maintenant.toISOString().slice(0, 10);
  const r = await db.query("SELECT planifier_ingestion_maintenance($1, $2, $3) AS n", [
    `ingestion_maintenance:${jour}`,
    new Date(`${jour}T${HEURE_MAINTENANCE_INGESTION_UTC}Z`),
    jour,
  ]);
  return r.rows[0].n as number;
}
