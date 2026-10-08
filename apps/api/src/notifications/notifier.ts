import { lienInterneSur } from "@missionpilot/shared";
import type { Trousseau } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import { differerEmail } from "./charge-email.js";
import type { Mailer } from "./mailer.js";

/**
 * Notifications in-app (SOC-08), réutilisables par tous les modules.
 *
 * Règles : texte brut (les chevrons sont retirés : aucun HTML ne peut être
 * interprété), lien relatif interne uniquement, destinataire actif du même
 * cabinet (RLS + clé composite). Aucun montant ni coût dans un titre ou un
 * corps : c'est à l'appelant de n'y mettre que des dates, des jours et des
 * libellés.
 */
export interface NouvelleNotification {
  cabinetId: string;
  destinataireId: string;
  /** Code technique : minuscules et tiret bas (ex. « absence_validee »). */
  type: string;
  titre: string;
  corps?: string;
  /** Lien relatif interne (« /mon-planning?semaine=… »), ou null. */
  lien?: string | null;
  /** Doubler par un e-mail (envoyé après la transaction, voir `envoyerEmails`). */
  email?: boolean;
}

/** Notification créée, avec l'e-mail à envoyer après validation de la transaction. */
export interface NotificationCreee {
  id: string;
  destinataire_id: string;
  email: { a: string; sujet: string; texte: string } | null;
}

const TAILLE_TITRE = 200;
const TAILLE_CORPS = 2000;

/** Texte brut : sans chevrons ni caractères de contrôle (hors saut de ligne), tronqué. */
export function texteBrut(texte: string, max: number): string {
  return (
    texte
      .replace(/[<>]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, max)
  );
}

/**
 * Titre sur une seule ligne (F1) : le titre devient le sujet de l'e-mail ; un
 * saut de ligne (CR, LF, NEL, séparateurs Unicode) y injecterait un en-tête
 * (« Bcc: … »), et un caractère de contrôle bidirectionnel en maquillerait
 * l'affichage. Chacun est remplacé par une espace (CHECK en base : 0021).
 */
export function titreUneLigne(titre: string): string {
  return titre.replace(/[\r\n\u0085\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g, " ");
}

/**
 * Crée une notification dans la transaction courante. Renvoie null si le
 * destinataire est inconnu ou inactif (rien n'est créé).
 */
export async function notifier(db: Db, n: NouvelleNotification): Promise<NotificationCreee | null> {
  if (!/^[a-z_]{1,60}$/.test(n.type)) throw new Error(`Type de notification refusé : ${n.type}`);
  const lien = n.lien ?? null;
  if (lien !== null && !lienInterneSur(lien)) throw new Error("Lien de notification refusé.");
  const destinataire = await db.query(
    "SELECT email FROM utilisateurs WHERE id = $1 AND cabinet_id = $2 AND actif",
    [n.destinataireId, n.cabinetId],
  );
  if (!destinataire.rows[0]) return null;
  const titre = texteBrut(titreUneLigne(n.titre), TAILLE_TITRE) || "Notification";
  const corps = texteBrut(n.corps ?? "", TAILLE_CORPS);
  const r = await db.query(
    `INSERT INTO notifications (cabinet_id, destinataire_id, type, titre, corps, lien)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [n.cabinetId, n.destinataireId, n.type, titre, corps, lien],
  );
  return {
    id: r.rows[0].id as string,
    destinataire_id: n.destinataireId,
    email: n.email
      ? {
          a: destinataire.rows[0].email as string,
          sujet: `MissionPilot — ${titre}`,
          texte: corps,
        }
      : null,
  };
}

/**
 * Notification in-app doublée d'un e-mail MIS EN FILE dans la même
 * transaction (job « envoyer_email », charge chiffrée) : l'e-mail ne part que
 * si l'action est validée, ne retarde pas la réponse et survit à un
 * redémarrage. Pour les alertes de sécurité (coordonnées bancaires, 2FA).
 */
export async function notifierAvecEmailEnFile(
  db: Db,
  trousseau: Trousseau,
  n: Omit<NouvelleNotification, "email">,
): Promise<NotificationCreee | null> {
  const creee = await notifier(db, { ...n, email: true });
  if (creee?.email) await differerEmail(db, trousseau, n.cabinetId, creee.email, 0);
  return creee;
}

/** Identifiants des associés actifs du cabinet courant (RLS). */
export async function associesActifs(db: Db): Promise<string[]> {
  const r = await db.query(
    "SELECT id FROM utilisateurs WHERE actif AND 'associe' = ANY (roles) ORDER BY id",
  );
  return r.rows.map((x) => x.id as string);
}

/**
 * Envoie les e-mails des notifications APRÈS validation de la transaction
 * (rien ne part pour une action annulée). Un échec d'envoi n'annule pas
 * l'action : la notification in-app reste.
 */
export async function envoyerEmails(
  mailer: Mailer,
  creees: readonly (NotificationCreee | null)[],
  journal: (message: string) => void = () => undefined,
): Promise<void> {
  for (const n of creees) {
    if (!n?.email) continue;
    try {
      await mailer.envoyer(n.email);
    } catch {
      journal(`Envoi de l'e-mail de la notification ${n.id} échoué.`);
    }
  }
}
