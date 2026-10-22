import { ajouterJours, lundiDeLaSemaine } from "@missionpilot/engines";
import { planifierDetectionAutomatisation } from "../automatisation/detection.js";
import { planifierCanauxMaintenance } from "../canaux/maintenance.js";
import { planifierSyntheseHebdo } from "../canaux/synthese.js";
import { planifierIngestionMaintenance } from "../ingestion/maintenance.js";
import { planifierPurgeCopilote } from "../copilote/purge.js";
import type { Database } from "../db/pool.js";
import { planifierBriefQuotidien } from "../brief/quotidien.js";
import { planifierAvancementHebdo } from "../automatisation/avancement-job.js";
import { planificationConservationIa } from "../ia/conservation.js";
import { planificationSuiviKpi } from "../kpi/suivi.js";
import { planifierPurgeRapports } from "../rapports/purge.js";

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
 * - Suivi des KPI (KPI-02, KPI-04) chaque jour à 7 h (UTC), pour les seuls
 *   cabinets ayant un KPI actif ; clé `kpi_suivi:jour` (kpi/suivi.ts).
 * - Purge des propositions d'actions du copilote (AGT-08) chaque jour à 2 h 30 (UTC), pour les
 *   seuls cabinets ayant une proposition échue ; clé `copilote_purge:jour` (copilote/purge.ts).
 * - Brief quotidien (AUT-07) chaque jour ouvré à 7 h (UTC), pour les cabinets ayant un
 *   utilisateur interne actif ; clé `brief_quotidien:jour` (brief/quotidien.ts).
 * - Canaux simulés (lot 3c) : synthèse hebdomadaire du dirigeant le lundi à 7 h 30 (UTC), pour les
 *   cabinets ayant un compte WhatsApp actif avec cette option (clé `synthese_hebdo:lundi`) ; maintenance
 *   quotidienne à 3 h 15 (UTC), clé `canaux_maintenance:jour` (canaux/maintenance.ts).
 * - Ingestion de documents (lot 6) : maintenance quotidienne à 3 h 45 (UTC), clé
 *   `ingestion_maintenance:jour` (ingestion/maintenance.ts), pour les cabinets ayant un document à purger.
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
    // Suivi des KPI : seulement les cabinets ayant un KPI actif.
    const k = planificationSuiviKpi(maintenant);
    total += (
      await db.query("SELECT planifier_suivi_kpi($1, $2, $3) AS n", [k.cle, k.executeA, k.jour])
    ).rows[0].n as number;
    // Conservation IA : seulement les cabinets ayant un texte dont la durée est échue.
    const ia = planificationConservationIa(maintenant);
    total += (
      await db.query("SELECT planifier_conservation_ia($1, $2) AS n", [ia.cle, ia.executeA])
    ).rows[0].n as number;
    // Purge des rapports échus : seulement les cabinets ayant un rapport à purger.
    total += await planifierPurgeRapports(db, maintenant);
    // Propositions d'actions du copilote échues (AGT-08) : seulement les cabinets concernés.
    total += await planifierPurgeCopilote(db, maintenant);
    // Détection des événements nés du temps (automatisation, AUT-01) : une par cabinet et par jour.
    total += await planifierDetectionAutomatisation(db, maintenant);
    // Brief quotidien par rôle (AUT-07) : une tâche par cabinet et par jour ouvré.
    total += await planifierBriefQuotidien(db, maintenant);
    // Rapport d'avancement hebdomadaire (AUT-10) : une tâche par cabinet et par semaine, jours ouvrés.
    total += await planifierAvancementHebdo(db, maintenant);
    // Canaux simulés (lot 3c) : synthèse du dirigeant le lundi 07:30 UTC, maintenance chaque jour 03:15 UTC.
    total += await planifierSyntheseHebdo(db, maintenant);
    total += await planifierCanauxMaintenance(db, maintenant);
    // Ingestion de documents (lot 6) : reprise des effacements et purge du texte, chaque jour 03:45 UTC.
    total += await planifierIngestionMaintenance(db, maintenant);
    return total;
  });
}
