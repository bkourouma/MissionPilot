import { periodeKpiDe } from "@missionpilot/engines";
import type { KpiCreation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit } from "../errors.js";
import { exigerMissionModifiable } from "../missions/acces.js";
import { exigerProprietaireValide } from "./acces.js";
import { MAX_KPI_PAR_MISSION } from "./donnees.js";

/*
 * Création d'une définition de KPI (KPI-01), commune à POST /missions/:id/kpi
 * (routes/kpi.ts) et à la création depuis un objectif du plan (plans/kpi.ts) :
 * mission modifiable (responsable, non clôturée), plafond MAX_KPI_PAR_MISSION,
 * propriétaire admis, début de suivi ramené au début de sa période par le
 * moteur KPI, cible initiale éventuelle (version 1) et journal « kpi.creer »,
 * dans la transaction de l'appelant. Le corps est déjà validé (`kpiCreationSchema`).
 */

/** Écriture décimale transmise à PostgreSQL (numeric), ou null. */
export const numerique = (v: number | null | undefined) =>
  v === null || v === undefined ? null : String(v);

export interface OptionsCreationKpi {
  /** Perspective prise quand le corps n'en porte pas (objectif du plan). */
  perspectiveParDefaut?: string | null;
  /** Détails d'audit en plus de la mission et du libellé. */
  detailsAudit?: Record<string, unknown>;
}

/** Insère le KPI de la mission et renvoie son identifiant. */
export async function insererKpi(
  db: Db,
  auth: Auth,
  missionId: string,
  c: KpiCreation,
  options: OptionsCreationKpi = {},
): Promise<string> {
  const mission = await exigerMissionModifiable(db, auth, missionId);
  const n = await db.query("SELECT count(*)::int AS n FROM kpi_definitions WHERE mission_id = $1", [
    missionId,
  ]);
  if ((n.rows[0].n as number) >= MAX_KPI_PAR_MISSION) {
    throw conflit(`Une mission compte au plus ${MAX_KPI_PAR_MISSION} KPI.`);
  }
  await exigerProprietaireValide(db, missionId, c.proprietaire_id);
  const debut = periodeKpiDe(c.debut_suivi, c.frequence).debut;
  const r = await db.query(
    `INSERT INTO kpi_definitions (cabinet_id, mission_id, client_id, libelle, description, unite,
       perspective, sens, nature, frequence, ponderation, seuil_vert, seuil_orange, alerte_haut,
       alerte_bas, alerte_variation, proprietaire_id, debut_suivi, fin_suivi, rappels_actifs,
       cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12::numeric, $13::numeric,
       $14::numeric, $15::numeric, $16::numeric, $17, $18, $19, $20, $21, $21)
     RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      mission.client_id,
      c.libelle,
      c.description ?? null,
      c.unite,
      c.perspective ?? options.perspectiveParDefaut ?? null,
      c.sens,
      c.nature,
      c.frequence,
      String(c.ponderation),
      numerique(c.seuil_vert),
      numerique(c.seuil_orange),
      numerique(c.alerte_haut),
      numerique(c.alerte_bas),
      numerique(c.alerte_variation),
      c.proprietaire_id ?? null,
      debut,
      c.fin_suivi ?? null,
      c.rappels_actifs,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (c.cible !== undefined) {
    await db.query(
      `INSERT INTO kpi_cibles (cabinet_id, kpi_id, version, valeur, a_partir_de, motif, cree_par)
       VALUES ($1, $2, 1, $3::numeric, $4, 'Cible initiale', $5)`,
      [auth.cabinetId, id, numerique(c.cible), debut, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.creer",
    entite: "kpi",
    entiteId: id,
    details: { mission_id: missionId, libelle: c.libelle, ...options.detailsAudit },
  });
  return id;
}
