import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { stockageDe } from "../stockage/index.js";
import type { DependancesCanaux } from "./fabrique.js";
import { expirerDemande } from "./signatures.js";

/*
 * Maintenance quotidienne des canaux (SPEC-3c §7.8) : UNE exécution par cabinet et par jour (03:15 UTC) :
 * codes de vérification échus effacés ; propositions de saisie échues `expiree` ; demandes de signature
 * échues `expiree` (preuve) ; événements du webhook de plus de 30 jours supprimés ; audio des
 * transcriptions effacé 30 jours après la décision (90 jours sans décision) ; transcriptions validées
 * depuis 365 jours anonymisées. Les envois sont conservés (journal sans contenu). Toutes ces durées
 * sont PROVISOIRES (SPEC-3c §15, O-04, O-09).
 */

export const TYPE_JOB_CANAUX_MAINTENANCE = "canaux_maintenance";
export const HEURE_MAINTENANCE_CANAUX_UTC = "03:15:00";
export const CONSERVATION_EVENEMENTS_JOURS = 30;
export const AUDIO_APRES_DECISION_JOURS = 30;
export const AUDIO_SANS_DECISION_JOURS = 90;
export const ANONYMISATION_TRANSCRIPTION_JOURS = 365;

const chargeSchema = z.object({ jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const JOUR_MS = 86_400_000;

export interface BilanMaintenance {
  codes_effaces: number;
  saisies_expirees: number;
  demandes_expirees: number;
  evenements_supprimes: number;
  audios_effaces: number;
  versions_anonymisees: number;
}

/** Applique la maintenance dans la transaction du cabinet ; renvoie les objets de stockage à effacer. */
export async function maintenirCanaux(
  db: Db,
  cabinetId: string,
  maintenant: Date,
): Promise<{ bilan: BilanMaintenance; cles: string[] }> {
  const codes = await db.query(
    `UPDATE canaux_destinataires SET code_empreinte = NULL, code_expire_le = NULL, code_essais = 0
     WHERE code_expire_le IS NOT NULL AND code_expire_le < $1`,
    [maintenant],
  );
  const saisies = await db.query(
    "UPDATE canaux_saisies_kpi SET statut = 'expiree' WHERE statut = 'a_confirmer' AND expire_le < $1",
    [maintenant],
  );
  const echues = await db.query(
    `SELECT id FROM signatures_demandes WHERE statut IN ('envoyee', 'partielle') AND expire_le < $1
     ORDER BY id`,
    [maintenant],
  );
  let demandes = 0;
  for (const d of echues.rows as { id: string }[]) {
    if (await expirerDemande(db, cabinetId, d.id, maintenant)) demandes += 1;
  }
  const evenements = await db.query("DELETE FROM canaux_evenements_recus WHERE recu_le < $1", [
    new Date(maintenant.getTime() - CONSERVATION_EVENEMENTS_JOURS * JOUR_MS),
  ]);
  // Audio : 30 jours après la validation ou le rejet, 90 jours sans décision.
  const audios = await db.query(
    `SELECT t.id, f.id AS fichier_id, f.cle_stockage
     FROM transcriptions t JOIN fichiers f ON f.id = t.fichier_id
     WHERE t.audio_supprime_le IS NULL
       AND ((t.statut IN ('validee', 'rejetee') AND t.valide_le < $1)
            OR (t.statut IN ('a_relire', 'echec') AND t.cree_le < $2))
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
     ORDER BY t.id LIMIT 200`,
    [
      new Date(maintenant.getTime() - AUDIO_APRES_DECISION_JOURS * JOUR_MS),
      new Date(maintenant.getTime() - AUDIO_SANS_DECISION_JOURS * JOUR_MS),
    ],
  );
  const cles: string[] = [];
  for (const a of audios.rows as { id: string; fichier_id: string; cle_stockage: string }[]) {
    await db.query(
      `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
       VALUES ($1, $2, 'retire', NULL)`,
      [cabinetId, a.fichier_id],
    );
    await db.query("UPDATE transcriptions SET audio_supprime_le = $2 WHERE id = $1", [
      a.id,
      maintenant,
    ]);
    await journaliser(db, {
      cabinetId,
      utilisateurId: null,
      action: "transcription.supprimer_audio",
      entite: "transcription",
      entiteId: a.id,
      details: {},
    });
    cles.push(a.cle_stockage);
  }
  const anonymisees = await db.query("SELECT anonymiser_transcriptions($1, $2) AS n", [
    maintenant,
    ANONYMISATION_TRANSCRIPTION_JOURS,
  ]);
  return {
    bilan: {
      codes_effaces: codes.rowCount ?? 0,
      saisies_expirees: saisies.rowCount ?? 0,
      demandes_expirees: demandes,
      evenements_supprimes: evenements.rowCount ?? 0,
      audios_effaces: cles.length,
      versions_anonymisees: anonymisees.rows[0].n as number,
    },
    cles,
  };
}

export function creerHandlerCanauxMaintenance(dependances: () => DependancesCanaux): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success)
      throw new ErreurJobDefinitive("Charge de maintenance des canaux invalide.");
    const { config } = dependances();
    const { cles } = await maintenirCanaux(ctx.db, ctx.cabinetId, ctx.maintenant);
    // Objets du stockage effacés APRÈS la validation des suppressions (le worker les valide).
    const stockage = stockageDe(config);
    for (const cle of cles) await stockage.supprimer(ctx.cabinetId, cle).catch(() => undefined);
    return [];
  };
}

/** Planification quotidienne : fonction étroite `planifier_canaux_maintenance` (03:15 UTC). */
export async function planifierCanauxMaintenance(db: Db, maintenant: Date): Promise<number> {
  const jour = maintenant.toISOString().slice(0, 10);
  const r = await db.query("SELECT planifier_canaux_maintenance($1, $2, $3) AS n", [
    `canaux_maintenance:${jour}`,
    new Date(`${jour}T${HEURE_MAINTENANCE_CANAUX_UTC}Z`),
    jour,
  ]);
  return r.rows[0].n as number;
}
