import { z } from "zod";
import { journaliser } from "../audit.js";
import { lireCoupeCircuit } from "../agents/autonomie.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit } from "../errors.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { destinatairesClient, type DemandeDb } from "./donnees.js";
import {
  attendDepot,
  DELAI_MIN_RELANCE_SALLE_HEURES,
  paliersAVenir,
  dateFr,
  type PalierAutomatique,
} from "./regles.js";

/*
 * Relances de la salle de mission (CLI-01), sur le modèle des relances graduées existantes
 * (questionnaires J+3 / J+7, factures J+15 / J+30 / J+45) : jobs de la file PostgreSQL
 * (ADR-002) mis en file à l'envoi et à chaque changement d'échéance, plus la relance manuelle.
 *
 * - Paliers (regles.ts) : rappel à J−3, relance à J+1, relance ferme à J+7 avec alerte au chef
 *   et au directeur de la mission. Clé de job `salle_relance:<demande>:<palier>:<échéance>` :
 *   un palier n'est mis en file qu'une fois par échéance ; un job dont l'échéance n'est plus
 *   celle de la demande (prolongée depuis) ne fait rien, celui de la nouvelle échéance relance.
 * - Le job ne relance que si la demande est toujours envoyée, ses relances automatiques actives
 *   et au moins une pièce attend un dépôt (demandée ou rejetée) ; destinataires : dirigeants et
 *   contributeurs actifs sur le portail. Idempotence : sous le verrou de la demande, un
 *   palier déjà inscrit pour un destinataire et cette échéance n'est pas renvoyé ; l'index
 *   unique `salle_relances_palier_uniq` reste la barrière finale.
 * - Classe R0 vers le client : le coupe-circuit N4 du cabinet (DECISIONS.md, 2026-10-08)
 *   SUSPEND les relances automatiques (journalisé) ; l'alerte interne de J+7 part quand même.
 *   La relance manuelle, décidée par un humain, n'y est pas soumise.
 *
 * Le handler `relanceSalleMission` s'inscrit dans REGISTRE_JOBS (jobs/registre.ts) sous
 * TYPE_JOB_RELANCE_SALLE ; il importe ErreurJobDefinitive de jobs/erreurs.ts.
 */

export const TYPE_JOB_RELANCE_SALLE = "relance_salle_mission";

const chargeSchema = z
  .object({
    demande_id: z.string().uuid(),
    palier: z.enum(["rappel_j_moins_3", "relance_j_plus_1", "relance_j_plus_7"]),
    echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

/** Met en file les paliers à venir pour cette échéance (dans la transaction de l'action). */
export async function planifierRelancesSalle(
  db: Db,
  cabinetId: string,
  demandeId: string,
  echeance: string,
  maintenant = new Date(),
): Promise<number> {
  let n = 0;
  for (const p of paliersAVenir(echeance, maintenant)) {
    const r = await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
      [
        cabinetId,
        TYPE_JOB_RELANCE_SALLE,
        JSON.stringify({ demande_id: demandeId, palier: p.palier, echeance }),
        p.executeA,
        `salle_relance:${demandeId}:${p.palier}:${echeance}`,
      ],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

async function piecesEnAttente(db: Db, demandeId: string): Promise<number> {
  const r = await db.query(
    `SELECT coalesce((SELECT e.statut FROM salle_piece_evenements e WHERE e.piece_id = p.id
                      ORDER BY e.rang DESC LIMIT 1), 'demandee') AS statut
     FROM salle_pieces p WHERE p.demande_id = $1`,
    [demandeId],
  );
  return r.rows.filter((l) => attendDepot(l.statut)).length;
}

const TEXTES: Record<PalierAutomatique | "manuelle", (titre: string, echeance: string) => string> =
  {
    rappel_j_moins_3: (t, e) =>
      `Rappel : des pièces de la demande « ${t} » sont attendues avant le ${dateFr(e)}.`,
    relance_j_plus_1: (t, e) =>
      `L'échéance du ${dateFr(e)} est passée : des pièces de la demande « ${t} » sont encore attendues.`,
    relance_j_plus_7: (t, e) =>
      `Relance : des pièces de la demande « ${t} » (échéance du ${dateFr(e)}) manquent toujours. Sans elles, la mission ne peut pas avancer comme prévu.`,
    manuelle: (t, e) =>
      `Votre cabinet vous rappelle que des pièces de la demande « ${t} » (échéance du ${dateFr(e)}) sont attendues.`,
  };

/** Notification (doublée d'un e-mail) d'un destinataire, puis trace de la relance. */
async function relancer(
  db: Db,
  cabinetId: string,
  demande: Pick<DemandeDb, "id" | "titre" | "client_id">,
  echeance: string,
  palier: PalierAutomatique | "manuelle",
  destinataireId: string,
  relancePar: string | null,
): Promise<NotificationCreee | null> {
  const n = await notifier(db, {
    cabinetId,
    destinataireId,
    type: "salle_relance",
    titre: `Documents attendus : « ${demande.titre} »`,
    corps: `${TEXTES[palier](demande.titre, echeance)} Déposez-les depuis votre portail client.`,
    lien: `/portail/salle/${demande.id}`,
    email: true,
  });
  if (!n) return null;
  await db.query(
    `INSERT INTO salle_relances (cabinet_id, demande_id, client_id, palier, echeance,
       destinataire_id, notification_id, relance_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [cabinetId, demande.id, demande.client_id, palier, echeance, destinataireId, n.id, relancePar],
  );
  return n;
}

/** Alerte interne de J+7 : chef et directeur de la mission (in-app). */
async function alerterEquipe(db: Db, cabinetId: string, demande: DemandeDb, enAttente: number) {
  const m = await db.query("SELECT chef_id, directeur_id FROM missions WHERE id = $1", [
    demande.mission_id,
  ]);
  const ids = new Set(
    [m.rows[0]?.chef_id, m.rows[0]?.directeur_id].filter((x): x is string => Boolean(x)),
  );
  for (const id of ids) {
    await notifier(db, {
      cabinetId,
      destinataireId: id,
      type: "salle_alerte_echeance",
      titre: `Pièces en retard : « ${demande.titre} »`,
      corps: `${enAttente} pièce${enAttente > 1 ? "s" : ""} de la demande « ${demande.titre} » ${enAttente > 1 ? "attendent" : "attend"} toujours un dépôt sept jours après l'échéance. Une relance personnelle du client est conseillée.`,
      lien: `/missions/${demande.mission_id}/salle/${demande.id}`,
    });
  }
}

/** Handler du job de relance automatique (idempotent). */
export const relanceSalleMission: HandlerJob = async ({ db, cabinetId, charge }) => {
  const c = chargeSchema.safeParse(charge);
  if (!c.success) throw new ErreurJobDefinitive("Charge de relance de la salle invalide.");
  const r = await db.query(
    `SELECT id, mission_id, client_id, titre, statut, relances_auto, echeance::text AS echeance
     FROM salle_demandes WHERE id = $1 FOR UPDATE`,
    [c.data.demande_id],
  );
  const demande = r.rows[0] as DemandeDb | undefined;
  if (!demande || demande.statut !== "envoyee" || !demande.relances_auto) return [];
  // Échéance changée depuis la mise en file : le job de la nouvelle échéance relancera.
  if (demande.echeance !== c.data.echeance) return [];
  const enAttente = await piecesEnAttente(db, demande.id);
  if (enAttente === 0) return [];
  if (c.data.palier === "relance_j_plus_7") await alerterEquipe(db, cabinetId, demande, enAttente);
  if ((await lireCoupeCircuit(db)).actif) {
    await journaliser(db, {
      cabinetId,
      utilisateurId: null,
      action: "salle_relance_suspendue",
      entite: "salle_demande",
      entiteId: demande.id,
      details: { palier: c.data.palier, classe_risque: "R0", motif: "coupe_circuit_n4" },
    });
    return [];
  }
  const faits = await db.query(
    `SELECT destinataire_id FROM salle_relances
     WHERE demande_id = $1 AND palier = $2 AND echeance = $3`,
    [demande.id, c.data.palier, c.data.echeance],
  );
  const deja = new Set(faits.rows.map((l) => l.destinataire_id as string));
  const notifications: NotificationCreee[] = [];
  for (const d of await destinatairesClient(db, demande.client_id)) {
    if (deja.has(d.id)) continue;
    const n = await relancer(db, cabinetId, demande, c.data.echeance, c.data.palier, d.id, null);
    if (n) notifications.push(n);
  }
  await journaliser(db, {
    cabinetId,
    utilisateurId: null,
    action: "salle_relance_auto",
    entite: "salle_demande",
    entiteId: demande.id,
    details: {
      palier: c.data.palier,
      classe_risque: "R0",
      destinataires: notifications.map((n) => n.destinataire_id),
    },
  });
  return notifications;
};

/**
 * Relance manuelle (demande envoyée, verrouillée par l'appelant) : destinataires actifs qui
 * n'ont pas été relancés depuis DELAI_MIN_RELANCE_SALLE_HEURES (409 si personne).
 */
export async function relancerManuellement(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
): Promise<NotificationCreee[]> {
  if (demande.statut !== "envoyee" || !demande.echeance) {
    throw conflit("Seule une demande envoyée, non close, se relance.");
  }
  if ((await piecesEnAttente(db, demande.id)) === 0) {
    throw conflit("Aucune pièce n'attend de dépôt : rien à relancer.");
  }
  const recentes = await db.query(
    `SELECT DISTINCT destinataire_id FROM salle_relances
     WHERE demande_id = $1 AND cree_le > now() - make_interval(hours => $2::int)`,
    [demande.id, DELAI_MIN_RELANCE_SALLE_HEURES],
  );
  const exclus = new Set(recentes.rows.map((l) => l.destinataire_id as string));
  const cibles = (await destinatairesClient(db, demande.client_id)).filter(
    (d) => !exclus.has(d.id),
  );
  if (cibles.length === 0) {
    throw conflit(
      `Personne à relancer : un destinataire ne se relance pas deux fois en moins de ${DELAI_MIN_RELANCE_SALLE_HEURES} h.`,
    );
  }
  const notifications: NotificationCreee[] = [];
  for (const d of cibles) {
    const n = await relancer(
      db,
      auth.cabinetId,
      demande,
      demande.echeance,
      "manuelle",
      d.id,
      auth.utilisateurId,
    );
    if (n) notifications.push(n);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_relance_manuelle",
    entite: "salle_demande",
    entiteId: demande.id,
    details: {
      mission_id: demande.mission_id,
      destinataires: notifications.map((n) => n.destinataire_id),
    },
  });
  return notifications;
}
