import { comparer, formaterMontant, zero } from "@missionpilot/engines";
import { DELAIS_RELANCE_DEPART } from "@missionpilot/shared";
import { ADRESSE_ASCII } from "../config.js";
import type { Db } from "../db/pool.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { MessageEmail } from "../notifications/mailer.js";
import { notifier, titreUneLigne, type NotificationCreee } from "../notifications/notifier.js";
import { lireParametresFacturation } from "../facturation/parametres.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
  type FacturePaiement,
  type Situation,
} from "./paiements.js";

/*
 * Relances des factures échues (FIN-09).
 *
 * - Tâche quotidienne « relances_factures » (planificateur, 6 h UTC, clé
 *   relances_factures:AAAA-MM-JJ) : pour chaque facture émise dont l'échéance
 *   est dépassée et le solde (moteur) positif, le niveau atteint est le
 *   nombre de délais du cabinet (J+7, J+15, J+30 par défaut, à valider)
 *   inférieurs ou égaux au retard. Une relance automatique est créée pour ce
 *   niveau s'il n'en existe aucune de niveau égal ou supérieur ; l'index
 *   unique (facture, niveau) garantit qu'un double passage ne la double pas.
 * - Chaque relance notifie les gestionnaires (à défaut, les associés) sans
 *   aucun montant, et prépare l'e-mail au contact du client (reste à payer,
 *   échéance). Il n'est envoyé que si le cabinet l'a activé
 *   (`envoi_email_client`, désactivé par défaut) : via la file d'e-mails
 *   chiffrée quand le worker en dispose, sinon après la transaction.
 * - Historique en ajout seul (migration 0061).
 */

export const TYPE_JOB_RELANCES = "relances_factures";

export interface ParametresRelances {
  delais_relance: number[];
  relances_actives: boolean;
  envoi_email_client: boolean;
  valeurs_validees: boolean;
}

export const PARAMETRES_RELANCES_DEPART: ParametresRelances = {
  delais_relance: [...DELAIS_RELANCE_DEPART],
  relances_actives: true,
  envoi_email_client: false,
  valeurs_validees: false,
};

export async function lireParametresRelances(db: Db): Promise<ParametresRelances> {
  const r = await db.query(
    `SELECT delais_relance::int[] AS delais_relance, relances_actives, envoi_email_client,
       valeurs_validees FROM parametres_relances`,
  );
  return (r.rows[0] as ParametresRelances | undefined) ?? PARAMETRES_RELANCES_DEPART;
}

/** Niveau atteint pour un retard : nombre de délais ≤ retard (0 : pas encore de relance). */
export function niveauAtteint(delais: readonly number[], joursRetard: number): number {
  return delais.filter((d) => d <= joursRetard).length;
}

const INTRO: Record<number, string> = {
  1: "Rappel amiable",
  2: "Deuxième relance",
  3: "Dernière relance avant mise en demeure",
};

/** Contact du client à relancer : principal d'abord, adresse ASCII valide. */
export async function contactClient(db: Db, clientId: string): Promise<string | null> {
  const r = await db.query(
    `SELECT email FROM contacts_client WHERE client_id = $1 AND email IS NOT NULL
     ORDER BY principal DESC, cree_le, id`,
    [clientId],
  );
  for (const l of r.rows) {
    const email = String(l.email).trim();
    if (email.length <= 254 && ADRESSE_ASCII.test(email)) return email;
  }
  return null;
}

/** E-mail de relance au client (texte brut ; montants formatés par le moteur). */
export function emailRelance(options: {
  a: string;
  emetteur: string;
  facture: FacturePaiement;
  situation: Situation;
  niveau: number;
  message?: string | null;
}): MessageEmail {
  const f = options.facture;
  const intro = INTRO[options.niveau] ?? "Relance";
  const lignes = [
    "Madame, Monsieur,",
    "",
    `${intro} : sauf erreur de notre part, la facture ${f.numero ?? ""} du ${f.date_emission ?? ""}, échue le ${f.date_echeance ?? ""}, n'est pas entièrement réglée (${options.situation.jours_retard} jours de retard).`,
    `Reste à payer : ${formaterMontant(options.situation.solde)}.`,
    ...(options.message ? ["", options.message] : []),
    "",
    "Si votre règlement est déjà parti, merci de ne pas tenir compte de ce message.",
    "",
    "Cordialement,",
    options.emetteur,
  ];
  return {
    a: options.a,
    sujet: titreUneLigne(`${options.emetteur} — ${intro} : facture ${f.numero ?? ""}`).slice(
      0,
      250,
    ),
    texte: lignes.join("\n").slice(0, 5000),
  };
}

export async function emetteurCabinet(db: Db, cabinetId: string): Promise<string> {
  const p = await lireParametresFacturation(db, cabinetId);
  const nom =
    p.raison_sociale ??
    ((await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId])).rows[0]?.nom as
      string | undefined) ??
    "Le service comptable";
  return titreUneLigne(nom).slice(0, 200);
}

/** Gestionnaires actifs du cabinet ; à défaut, les associés actifs. */
async function destinatairesInternes(db: Db): Promise<string[]> {
  const r = await db.query(
    `SELECT id, 'gestionnaire' = ANY (roles) AS gestionnaire FROM utilisateurs
     WHERE actif AND roles && ARRAY['gestionnaire', 'associe'] ORDER BY id`,
  );
  const gestionnaires = r.rows.filter((u) => u.gestionnaire).map((u) => u.id as string);
  return gestionnaires.length > 0 ? gestionnaires : r.rows.map((u) => u.id as string);
}

export interface RelanceCreee {
  id: string;
  email: MessageEmail | null;
  notifications: NotificationCreee[];
}

/**
 * Enregistre une relance (automatique : seulement si elle n'existe pas déjà
 * pour ce niveau) et notifie l'équipe. Renvoie null si rien n'a été créé.
 */
export async function enregistrerRelance(
  db: Db,
  options: {
    cabinetId: string;
    facture: FacturePaiement;
    situation: Situation;
    niveau: number;
    mode: "automatique" | "manuelle";
    date: string;
    envoyer: boolean;
    auteurId: string | null;
    message?: string | null;
  },
): Promise<RelanceCreee | null> {
  const { facture: f, situation: s } = options;
  const contact = await contactClient(db, f.client_id);
  const email = contact
    ? emailRelance({
        a: contact,
        emetteur: await emetteurCabinet(db, options.cabinetId),
        facture: f,
        situation: s,
        niveau: options.niveau,
        message: options.message ?? null,
      })
    : null;
  const envoye = options.envoyer && email !== null;
  const r = await db.query(
    `INSERT INTO relances_factures (cabinet_id, facture_id, niveau, mode, date_relance, jours_retard,
       destinataire_email, email_sujet, email_texte, email_envoye, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (cabinet_id, facture_id, niveau) WHERE mode = 'automatique' DO NOTHING
     RETURNING id`,
    [
      options.cabinetId,
      f.id,
      options.niveau,
      options.mode,
      options.date,
      s.jours_retard,
      email?.a ?? null,
      email?.sujet ?? null,
      email?.texte ?? null,
      envoye,
      options.auteurId,
    ],
  );
  if (!r.rows[0]) return null;
  const id = r.rows[0].id as string;
  const etatEmail = envoye
    ? "E-mail de relance envoyé au client."
    : email
      ? "E-mail de relance préparé (envoi automatique désactivé) : à envoyer par une relance manuelle."
      : "Aucun contact du client avec une adresse e-mail : relancer par un autre moyen.";
  const notifications: NotificationCreee[] = [];
  for (const destinataireId of await destinatairesInternes(db)) {
    if (destinataireId === options.auteurId) continue;
    const n = await notifier(db, {
      cabinetId: options.cabinetId,
      destinataireId,
      type: "relance_facture",
      titre: `Relance de niveau ${options.niveau} : facture ${f.numero ?? ""}`,
      // Aucun montant dans une notification : numéro, dates et retard seulement.
      corps: `Facture ${f.numero ?? ""} échue le ${f.date_echeance ?? ""}, ${s.jours_retard} jours de retard. ${etatEmail}`,
      lien: `/facturation/factures/${f.id}`,
      email: options.mode === "automatique",
    });
    if (n) notifications.push(n);
  }
  return { id, email: envoye ? email : null, notifications };
}

/** Factures émises échues à une date, avec leur situation de paiement (moteur). */
export async function facturesEchues(
  db: Db,
  date: string,
): Promise<{ facture: FacturePaiement; situation: Situation }[]> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT} FROM factures f
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_echeance < $1
     ORDER BY f.date_echeance, f.id`,
    [date],
  );
  const factures = r.rows.map(versFacturePaiement);
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
    date,
  );
  return factures
    .map((facture) => ({
      facture,
      situation: situationPaiement(facture, imputations.get(facture.id) ?? [], date),
    }))
    .filter(({ situation }) => comparer(situation.solde, zero(situation.solde.devise)) > 0);
}

/** Niveau de relance le plus élevé déjà envoyé par facture (tous modes). */
async function niveauxEnvoyes(db: Db, factureIds: string[]): Promise<Map<string, number>> {
  if (factureIds.length === 0) return new Map();
  const r = await db.query(
    `SELECT facture_id, max(niveau)::int AS niveau FROM relances_factures
     WHERE facture_id = ANY ($1::uuid[]) GROUP BY facture_id`,
    [factureIds],
  );
  return new Map(r.rows.map((l) => [l.facture_id as string, l.niveau as number]));
}

/**
 * Handler de la tâche quotidienne. `differer` (fourni par le worker de
 * production, voir notifications/file-email.ts) met l'e-mail au client dans
 * la file chiffrée, dans la transaction du job ; sans lui, l'e-mail est
 * renvoyé pour un envoi après validation de la transaction.
 */
export function creerHandlerRelances(
  differer?: (db: Db, cabinetId: string, message: MessageEmail) => Promise<unknown>,
): HandlerJob {
  return async ({ db, cabinetId, maintenant }) => {
    const parametres = await lireParametresRelances(db);
    if (!parametres.relances_actives) return [];
    const date = maintenant.toISOString().slice(0, 10);
    const echues = await facturesEchues(db, date);
    const deja = await niveauxEnvoyes(
      db,
      echues.map((e) => e.facture.id),
    );
    const sorties: (NotificationCreee | null)[] = [];
    for (const { facture, situation } of echues) {
      const niveau = niveauAtteint(parametres.delais_relance, situation.jours_retard);
      if (niveau === 0 || (deja.get(facture.id) ?? 0) >= niveau) continue;
      const creee = await enregistrerRelance(db, {
        cabinetId,
        facture,
        situation,
        niveau,
        mode: "automatique",
        date,
        envoyer: parametres.envoi_email_client,
        auteurId: null,
      });
      if (!creee) continue;
      sorties.push(...creee.notifications);
      if (creee.email) {
        if (differer) await differer(db, cabinetId, creee.email);
        else sorties.push({ id: creee.id, destinataire_id: "", email: creee.email });
      }
    }
    return sorties;
  };
}
