import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, requeteInvalide } from "../errors.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { notifier, titreUneLigne, type NotificationCreee } from "../notifications/notifier.js";
import type { Envoi } from "./acces.js";

/*
 * Relances des répondants (DECISIONS.md, V2) : automatiques par e-mail à J+3
 * puis J+7 après l'envoi, relance manuelle par le consultant.
 *
 * - À l'envoi, deux jobs « relance_questionnaire » sont mis en file (ADR-002),
 *   exécutables à envoye_le + 3 j et + 7 j (charge : envoi et palier).
 * - Le job ne relance que si l'envoi est toujours « envoyé » et ses relances
 *   automatiques actives (désactivables par envoi à tout moment), et
 *   seulement les répondants qui n'ont pas soumis (collectif : tous, tant
 *   que la réponse partagée n'est pas soumise) et qui peuvent encore
 *   répondre : utilisateur actif, au rôle de dirigeant ou de contributeur
 *   client, rattachement au portail actif, client actif.
 * - Une relance n'est inscrite dans l'historique qu'APRÈS une notification
 *   effectivement créée : un destinataire devenu inactif n'est pas compté
 *   comme relancé.
 * - Idempotence : sous le verrou de l'envoi (FOR UPDATE), un palier déjà
 *   inscrit n'est ni renotifié ni réinscrit ; l'index unique (répondant,
 *   palier) de 0142 reste la barrière finale.
 * - Relance manuelle : mission non clôturée (route), répondants en attente ;
 *   un répondant relancé (automatiquement ou non) il y a moins de 24 h ne
 *   l'est pas de nouveau (409 s'il est explicitement ciblé, ou si plus
 *   personne ne reste à relancer).
 * - E-mail par le notificateur existant (notification in-app doublée d'un
 *   e-mail envoyé après validation de la transaction).
 *
 * Le handler est inscrit dans REGISTRE_JOBS (jobs/registre.ts) sous
 * TYPE_JOB_RELANCE_QUESTIONNAIRE ; il importe ErreurJobDefinitive de
 * jobs/erreurs.ts (pas d'importation circulaire avec le registre).
 */

/** Délai minimal entre deux relances d'un même répondant (relance manuelle). */
export const DELAI_MIN_RELANCE_HEURES = 24;

export const TYPE_JOB_RELANCE_QUESTIONNAIRE = "relance_questionnaire";

/** Paliers automatiques : jours après l'envoi (DECISIONS.md : J+3 puis J+7). */
export const PALIERS_RELANCE = [
  { nature: "j3", jours: 3 },
  { nature: "j7", jours: 7 },
] as const;

const chargeSchema = z
  .object({ envoi_id: z.string().uuid(), nature: z.enum(["j3", "j7"]) })
  .strict();

/** Met en file les relances automatiques d'un envoi (dans la transaction de l'envoi). */
export async function planifierRelances(db: Db, cabinetId: string, envoiId: string) {
  for (const p of PALIERS_RELANCE) {
    await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a)
       SELECT $1, $2, $3, e.envoye_le + make_interval(days => $4::int)
       FROM questionnaire_envois e WHERE e.id = $5`,
      [
        cabinetId,
        TYPE_JOB_RELANCE_QUESTIONNAIRE,
        JSON.stringify({ envoi_id: envoiId, nature: p.nature }),
        p.jours,
        envoiId,
      ],
    );
  }
}

interface Cible {
  repondant_id: string;
  utilisateur_id: string;
}

/**
 * Répondant qui peut encore répondre : utilisateur actif au rôle de dirigeant
 * ou de contributeur client, rattaché au portail (actif) du client de
 * l'envoi, client actif (mêmes conditions que la désignation, 0141, et que
 * la garde du portail).
 */
const REPONDANT_ELIGIBLE = `JOIN utilisateurs u ON u.id = r.utilisateur_id AND u.actif
    AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']
  JOIN utilisateurs_portail up ON up.utilisateur_id = r.utilisateur_id
    AND up.client_id = r.client_id AND up.statut = 'actif'
  JOIN clients c ON c.id = r.client_id AND c.actif`;

/**
 * Répondants éligibles d'un envoi qui n'ont pas soumis (collectif : tous,
 * tant que la réponse partagée ne l'est pas).
 */
export async function repondantsEnAttente(db: Db, envoi: Pick<Envoi, "id" | "mode">) {
  const nonSoumis =
    envoi.mode === "collectif"
      ? `SELECT 1 FROM questionnaire_reponses q WHERE q.envoi_id = r.envoi_id
           AND q.repondant_id IS NULL AND q.statut = 'soumise'`
      : `SELECT 1 FROM questionnaire_reponses q WHERE q.repondant_id = r.id AND q.statut = 'soumise'`;
  const r = await db.query(
    `SELECT r.id AS repondant_id, r.utilisateur_id FROM questionnaire_repondants r
     ${REPONDANT_ELIGIBLE}
     WHERE r.envoi_id = $1 AND NOT EXISTS (${nonSoumis})
     ORDER BY r.ajoute_le, r.id`,
    [envoi.id],
  );
  return r.rows as Cible[];
}

async function nomCabinet(db: Db, cabinetId: string): Promise<string> {
  const r = await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId]);
  return titreUneLigne(String(r.rows[0]?.nom ?? "Votre cabinet de conseil")).slice(0, 120);
}

/** Notification (doublée d'un e-mail) d'un répondant : invitation ou relance. */
export async function notifierRepondant(
  db: Db,
  options: {
    cabinetId: string;
    utilisateurId: string;
    envoi: Pick<Envoi, "id" | "titre" | "date_limite">;
    relance: boolean;
  },
): Promise<NotificationCreee | null> {
  const cabinet = await nomCabinet(db, options.cabinetId);
  const titre = options.envoi.titre;
  const echeance = options.envoi.date_limite
    ? ` Merci de répondre avant le ${options.envoi.date_limite}.`
    : "";
  return notifier(db, {
    cabinetId: options.cabinetId,
    destinataireId: options.utilisateurId,
    type: options.relance ? "questionnaire_relance" : "questionnaire_a_completer",
    titre: options.relance
      ? `Rappel : questionnaire « ${titre} » à compléter`
      : `Questionnaire à compléter : « ${titre} »`,
    corps: options.relance
      ? `${cabinet} vous rappelle que le questionnaire « ${titre} » attend votre réponse.${echeance} Vos réponses sont enregistrées au fur et à mesure.`
      : `${cabinet} vous invite à répondre au questionnaire « ${titre} » depuis votre portail client.${echeance}`,
    lien: `/portail/questionnaires/${options.envoi.id}`,
    email: true,
  });
}

/** Handler du job de relance automatique (idempotent). */
export const relanceQuestionnaire: HandlerJob = async ({ db, cabinetId, charge }) => {
  const c = chargeSchema.safeParse(charge);
  if (!c.success) throw new ErreurJobDefinitive("Charge de relance de questionnaire invalide.");
  const e = await db.query(
    `SELECT id, titre, mode, statut, relances_auto, date_limite::text AS date_limite
     FROM questionnaire_envois WHERE id = $1 FOR UPDATE`,
    [c.data.envoi_id],
  );
  const envoi = e.rows[0] as
    Pick<Envoi, "id" | "titre" | "mode" | "statut" | "relances_auto" | "date_limite"> | undefined;
  if (!envoi || envoi.statut !== "envoye" || !envoi.relances_auto) return [];
  // Sous le verrou de l'envoi : paliers déjà inscrits (second passage, second worker).
  const faits = await db.query(
    "SELECT repondant_id FROM questionnaire_relances WHERE envoi_id = $1 AND nature = $2",
    [envoi.id, c.data.nature],
  );
  const dejaRelances = new Set(faits.rows.map((l) => l.repondant_id as string));
  const notifications: NotificationCreee[] = [];
  for (const cible of await repondantsEnAttente(db, envoi)) {
    if (dejaRelances.has(cible.repondant_id)) continue;
    const notification = await notifierRepondant(db, {
      cabinetId,
      utilisateurId: cible.utilisateur_id,
      envoi,
      relance: true,
    });
    if (!notification) continue;
    await db.query(
      `INSERT INTO questionnaire_relances (cabinet_id, envoi_id, repondant_id, nature)
       VALUES ($1, $2, $3, $4)`,
      [cabinetId, envoi.id, cible.repondant_id, c.data.nature],
    );
    notifications.push(notification);
  }
  return notifications;
};

/** Répondants de l'envoi relancés (toute nature) depuis moins de DELAI_MIN_RELANCE_HEURES. */
async function relancesRecentes(db: Db, envoiId: string): Promise<Set<string>> {
  const r = await db.query(
    `SELECT DISTINCT repondant_id FROM questionnaire_relances
     WHERE envoi_id = $1 AND relance_le > now() - make_interval(hours => $2::int)`,
    [envoiId, DELAI_MIN_RELANCE_HEURES],
  );
  return new Set(r.rows.map((l) => l.repondant_id as string));
}

/**
 * Cibles d'une relance manuelle : répondants en attente (tous, ou ceux
 * listés), hors ceux relancés depuis moins de DELAI_MIN_RELANCE_HEURES (409
 * si l'un d'eux est explicitement ciblé, ou si plus personne ne reste).
 */
async function ciblesManuelles(
  db: Db,
  envoi: Envoi,
  repondantIds: readonly string[] | undefined,
): Promise<Cible[]> {
  const enAttente = await repondantsEnAttente(db, envoi);
  let cibles = enAttente;
  if (repondantIds) {
    const connus = await db.query(
      "SELECT id FROM questionnaire_repondants WHERE envoi_id = $1 AND id = ANY($2::uuid[])",
      [envoi.id, repondantIds],
    );
    if (connus.rowCount !== new Set(repondantIds).size) {
      throw requeteInvalide("Répondant inconnu pour ce questionnaire.");
    }
    cibles = enAttente.filter((c) => repondantIds.includes(c.repondant_id));
  }
  if (cibles.length === 0) throw conflit("Aucun répondant en attente à relancer.");
  const recentes = await relancesRecentes(db, envoi.id);
  const delai = `Un répondant ne se relance pas deux fois en moins de ${DELAI_MIN_RELANCE_HEURES} h.`;
  if (repondantIds && cibles.some((c) => recentes.has(c.repondant_id))) throw conflit(delai);
  cibles = cibles.filter((c) => !recentes.has(c.repondant_id));
  if (cibles.length === 0) throw conflit(delai);
  return cibles;
}

/**
 * Relance manuelle des répondants en attente (tous, ou ceux listés), sous le
 * verrou de l'envoi posé par l'appelant ; la mission est contrôlée ouverte par
 * la route. Seules les relances effectivement notifiées sont inscrites.
 */
export async function relancerManuellement(
  db: Db,
  auth: Auth,
  envoi: Envoi,
  repondantIds: readonly string[] | undefined,
): Promise<{ relances: number; notifications: NotificationCreee[] }> {
  if (envoi.statut !== "envoye") {
    throw conflit("Seul un questionnaire envoyé, non clos, se relance.");
  }
  const notifications: NotificationCreee[] = [];
  const relances: string[] = [];
  for (const cible of await ciblesManuelles(db, envoi, repondantIds)) {
    const notification = await notifierRepondant(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: cible.utilisateur_id,
      envoi,
      relance: true,
    });
    if (!notification) continue;
    await db.query(
      `INSERT INTO questionnaire_relances (cabinet_id, envoi_id, repondant_id, nature, relance_par)
       VALUES ($1, $2, $3, 'manuelle', $4)`,
      [auth.cabinetId, envoi.id, cible.repondant_id, auth.utilisateurId],
    );
    notifications.push(notification);
    relances.push(cible.repondant_id);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "relance_manuelle",
    entite: "questionnaire_envoi",
    entiteId: envoi.id,
    details: { repondants: relances },
  });
  return { relances: relances.length, notifications };
}
