import type { Auth } from "../auth/contexte.js";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { associesActifs, notifier, type NotificationCreee } from "../notifications/notifier.js";

/*
 * Plafond de coût IA PAR MISSION (AGT-06), en plus du plafond mensuel du
 * cabinet (ia/couts.ts, qui reste appliqué à chaque appel). Coût de la mission
 * = consommations inscrites (ia_consommations) + réservations en cours de ses
 * demandes, sommées ici sur des ENTIERS (µUSD), comme ia/couts.ts.
 *
 * PORTÉE (lot 4c) : le plafond s'applique à TOUT appel IA rattaché à une mission, pas seulement
 * aux agents. L'orchestrateur (ia/orchestrateur.ts) le contrôle lui-même :
 * - à la préparation (`preparer`, toute demande portant `entite.missionId`, IA utilisable) :
 *   `controlerPlafondMission` ; en mode immédiat, la réservation du coût estimé suit dans la MÊME
 *   transaction ; en file, c'est un refus précoce, la réservation se fait à l'exécution ;
 * - à l'exécution (`executerDemande`, donc aussi le job `ia_generation`) :
 *   `plafondMissionAvantReservation`, sous le même verrou, juste avant la réservation, pour une
 *   demande qui n'a pas encore de réservation.
 * Le hook `controleAvantReservation` des agents (agents/executions.ts) reste valable : il prend le
 * même verrou (réentrant dans la transaction). Les appels SANS demande (`appelerSansDemande`, le
 * copilote) et les évaluations de non-régression ne sont rattachés à aucune mission : hors champ.
 *
 * Concurrence : contrôle et réservation se font sous un verrou consultatif PAR MISSION tenu
 * jusqu'à la fin de la transaction qui réserve le coût estimé de l'appel (ia_reservations,
 * comptée ci-dessous) : deux appels simultanés d'une même mission sont sérialisés, le second voit
 * la réservation du premier. Ordre des verrous : mission, puis cabinet (couts.ts) — jamais
 * l'inverse. Borne garantie : le contrôle porte sur « consommé + réservé ≥ plafond » avant
 * l'appel ; des appels simultanés ne dépassent donc pas le plafond de plus du coût estimé du
 * dernier admis (et le coût réel d'un appel ne dépasse pas son estimation, sauf jetons d'entrée
 * sous-estimés).
 * Seuil d'alerte : 80 % (PRD complémentaire §16), comparé en entiers ; notification aux associés
 * une fois par seuil (80 %, 100 %) et par valeur du plafond (`alertesPlafondMission`, table
 * ia_alertes_plafond_mission), sans montant, in-app seulement.
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

/** Verrou consultatif de la mission pour le contrôle de son plafond (jusqu'à la fin de la transaction). */
export async function verrouillerPlafondMission(db: Db, missionId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ia_plafond_mission:${missionId}`,
  ]);
}

/**
 * Contrôle du plafond de la mission SOUS VERROU (dans la transaction qui réservera le coût) :
 * vrai si le plafond est atteint et que l'appelant accepte le mode dégradé ; erreur sinon.
 */
export async function controlerPlafondMission(
  db: Db,
  missionId: string,
  maintenant: Date,
  repliSiPlafond: boolean,
  refus: () => Error,
): Promise<boolean> {
  await verrouillerPlafondMission(db, missionId);
  const etat = await etatPlafondMission(db, missionId, maintenant);
  if (etat.atteint && !repliSiPlafond) throw refus();
  return etat.atteint;
}

/**
 * Contrôle d'exécution (job `ia_generation` compris), dans la transaction qui va réserver : vrai si
 * le plafond de la mission est atteint. Une demande déjà réservée (mode immédiat : contrôlée et
 * réservée à la préparation) n'est pas recontrôlée — sa propre réservation compterait contre elle.
 */
export async function plafondMissionAvantReservation(
  db: Db,
  missionId: string,
  demandeId: string,
  maintenant: Date,
): Promise<boolean> {
  await verrouillerPlafondMission(db, missionId);
  const deja = await db.query(
    "SELECT 1 FROM ia_reservations WHERE demande_id = $1 AND expire_le > $2",
    [demandeId, maintenant],
  );
  if (deja.rows[0]) return false;
  return (await etatPlafondMission(db, missionId, maintenant)).atteint;
}

/** Seuils d'alerte du plafond d'une mission (consommation réelle). */
export const SEUILS_ALERTE_MISSION = [SEUIL_ALERTE_MISSION_PCT, 100] as const;

/**
 * Alerte les associés une fois par seuil franchi (80 %, 100 %) et par valeur du plafond de la
 * mission (relever ou abaisser le plafond réarme les alertes) : consommation RÉELLE inscrite,
 * comparée en entiers. Notification in-app sans montant (règle de notifier).
 */
export async function alertesPlafondMission(
  db: Db,
  cabinetId: string,
  missionId: string,
): Promise<(NotificationCreee | null)[]> {
  const p = await db.query(
    "SELECT plafond_micro_usd::text AS plafond FROM agents_plafonds_mission WHERE mission_id = $1",
    [missionId],
  );
  if (!p.rows[0]) return [];
  const plafond = Number(p.rows[0].plafond);
  if (plafond <= 0) return [];
  const c = await db.query(
    "SELECT cout_micro_usd::text AS cout FROM ia_consommations WHERE mission_id = $1",
    [missionId],
  );
  const consomme = somme(c.rows.map((x) => Number(x.cout)));
  const notifications: (NotificationCreee | null)[] = [];
  for (const seuil of SEUILS_ALERTE_MISSION) {
    if (consomme * 100 < plafond * seuil) continue;
    const r = await db.query(
      `INSERT INTO ia_alertes_plafond_mission (cabinet_id, mission_id, plafond_micro_usd, seuil)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING seuil`,
      [cabinetId, missionId, plafond, seuil],
    );
    if (!r.rows[0]) continue;
    for (const associe of await associesActifs(db)) {
      notifications.push(
        await notifier(db, {
          cabinetId,
          destinataireId: associe,
          type: "ia_plafond_mission_alerte",
          titre:
            seuil >= 100
              ? "IA : plafond de coût d'une mission atteint"
              : `IA : ${seuil} % du plafond de coût d'une mission consommés`,
          corps:
            seuil >= 100
              ? "Les générations IA de cette mission sont refusées (ou produites par gabarit) jusqu'au relèvement de son plafond."
              : "Vérifiez la consommation IA de la mission et, au besoin, son plafond.",
          lien: `/missions/${missionId}`,
          email: false,
        }),
      );
    }
  }
  return notifications;
}

/** Définit (ou retire, `null`) le plafond d'une mission déjà vérifiée par l'appelant. */
export async function definirPlafondMission(
  db: Db,
  auth: Auth,
  missionId: string,
  plafond: number | null,
): Promise<void> {
  await verrouillerPlafondMission(db, missionId);
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
