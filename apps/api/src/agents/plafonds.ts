import type { Auth } from "../auth/contexte.js";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";

/*
 * Plafond de coût IA PAR MISSION (AGT-06), en plus du plafond mensuel du
 * cabinet (ia/couts.ts, qui reste appliqué à chaque appel). Coût de la mission
 * = consommations inscrites (ia_consommations) + réservations en cours de ses
 * demandes, sommées ici sur des ENTIERS (µUSD), comme ia/couts.ts.
 *
 * Limite assumée : la vérification précède l'appel sans réserver au niveau de
 * la mission (le plafond du cabinet, lui, réserve) ; deux exécutions
 * simultanées peuvent dépasser le plafond de la mission d'une estimation.
 * Seuil d'alerte : 80 % (PRD complémentaire §16), comparé en entiers.
 */

export const SEUIL_ALERTE_MISSION_PCT = 80;

const somme = (valeurs: readonly number[]) => valeurs.reduce((s, v) => s + v, 0);

export interface EtatPlafondMission {
  plafond_micro_usd: number | null;
  consomme_micro_usd: number;
  /** Consommation ≥ plafond. */
  atteint: boolean;
  /** Consommation ≥ 80 % du plafond. */
  alerte: boolean;
}

/** Coût IA de la mission (µUSD) : consommations + réservations en cours. */
export async function consommeMission(
  db: Db,
  missionId: string,
  maintenant: Date,
): Promise<number> {
  const c = await db.query(
    "SELECT cout_micro_usd::text AS cout FROM ia_consommations WHERE mission_id = $1",
    [missionId],
  );
  const r = await db.query(
    `SELECT r.cout_estime_micro_usd::text AS cout FROM ia_reservations r
     JOIN ia_demandes d ON d.id = r.demande_id
     WHERE d.mission_id = $1 AND r.expire_le > $2`,
    [missionId, maintenant],
  );
  return somme([...c.rows, ...r.rows].map((x) => Number(x.cout)));
}

export async function etatPlafondMission(
  db: Db,
  missionId: string,
  maintenant: Date,
): Promise<EtatPlafondMission> {
  const p = await db.query(
    "SELECT plafond_micro_usd::text AS plafond FROM agents_plafonds_mission WHERE mission_id = $1",
    [missionId],
  );
  const plafond = p.rows[0] ? Number(p.rows[0].plafond) : null;
  const consomme = await consommeMission(db, missionId, maintenant);
  return {
    plafond_micro_usd: plafond,
    consomme_micro_usd: consomme,
    atteint: plafond !== null && consomme >= plafond,
    alerte: plafond !== null && consomme * 100 >= plafond * SEUIL_ALERTE_MISSION_PCT,
  };
}

/** Définit (ou retire, `null`) le plafond d'une mission déjà vérifiée par l'appelant. */
export async function definirPlafondMission(
  db: Db,
  auth: Auth,
  missionId: string,
  plafond: number | null,
): Promise<void> {
  if (plafond === null) {
    await db.query("DELETE FROM agents_plafonds_mission WHERE mission_id = $1", [missionId]);
  } else {
    await db.query(
      `INSERT INTO agents_plafonds_mission (cabinet_id, mission_id, plafond_micro_usd, modifie_par)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cabinet_id, mission_id) DO UPDATE
         SET plafond_micro_usd = excluded.plafond_micro_usd, modifie_par = excluded.modifie_par,
             modifie_le = now()`,
      [auth.cabinetId, missionId, plafond, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plafond_ia_mission",
    entite: "mission",
    entiteId: missionId,
    details: { plafond_micro_usd: plafond },
  });
}
