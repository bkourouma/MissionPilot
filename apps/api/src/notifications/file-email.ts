import { dechiffrer, type Trousseau } from "../auth/chiffrement.js";
import type { Database } from "../db/pool.js";
import {
  creerRegistre,
  ErreurJobDefinitive,
  REGISTRE_JOBS,
  type HandlerJob,
  type RegistreJobs,
} from "../jobs/registre.js";
import { creerHandlerRelances, TYPE_JOB_RELANCES } from "../finance/relances.js";
import { aad, chargeSchema, differerEmail, messageSchema, TYPE_JOB_EMAIL } from "./charge-email.js";
import type { Mailer, MessageEmail } from "./mailer.js";

/*
 * Reprise des e-mails par la file de tâches (ADR-002) : un e-mail dont l'envoi
 * immédiat (après validation de la transaction) échoue est mis en file sous le
 * type « envoyer_email », avec tentatives et délai croissant (1, 2, 4, 8 min).
 *
 * La charge peut contenir un lien d'invitation : elle est stockée CHIFFRÉE
 * (AES-256-GCM, clé dédiée « file_email », AAD liée au cabinet) et effacée
 * dès que l'envoi réussit. Jamais de contenu d'e-mail en clair en base.
 */

export {
  aad,
  chargeSchema,
  differerEmail,
  messageSchema,
  TENTATIVES_EMAIL,
  TYPE_JOB_EMAIL,
} from "./charge-email.js";

/**
 * Envoie tout de suite (à appeler APRÈS la validation de la transaction) ;
 * en cas d'échec, met l'e-mail en file pour une reprise. Ne lève pas : l'action
 * métier est déjà validée. Le journal ne cite ni l'adresse ni le contenu.
 */
export async function envoyerOuDifferer(options: {
  database: Database;
  mailer: Mailer;
  trousseau: Trousseau;
  cabinetId: string;
  message: MessageEmail;
  journal?: (message: string) => void;
}): Promise<"envoye" | "differe" | "perdu"> {
  const journal = options.journal ?? (() => undefined);
  try {
    await options.mailer.envoyer(options.message);
    return "envoye";
  } catch {
    try {
      const id = await options.database.withTenant(options.cabinetId, (db) =>
        differerEmail(db, options.trousseau, options.cabinetId, options.message),
      );
      journal(`Envoi d'e-mail échoué : nouvelle tentative par le job ${id}.`);
      return "differe";
    } catch {
      journal("Envoi d'e-mail échoué et mise en file impossible.");
      return "perdu";
    }
  }
}

/** Handler du job « envoyer_email » : déchiffre, envoie, efface la charge. */
export function creerHandlerEmail(mailer: Mailer, trousseau: Trousseau): HandlerJob {
  return async ({ db, cabinetId, jobId, charge }) => {
    const c = chargeSchema.safeParse(charge);
    if (!c.success) throw new ErreurJobDefinitive("Charge d'e-mail invalide.");
    let message: MessageEmail;
    try {
      const clair = dechiffrer(
        trousseau,
        "file_email",
        { version: c.data.v, donnees: Buffer.from(c.data.d, "base64") },
        aad(cabinetId),
      );
      message = messageSchema.parse(JSON.parse(clair.toString("utf8")));
    } catch {
      throw new ErreurJobDefinitive("Charge d'e-mail illisible.");
    }
    try {
      await mailer.envoyer(message);
    } catch {
      // Message générique : ni l'adresse, ni la réponse du serveur, ni un identifiant.
      throw new Error("Envoi de l'e-mail échoué.");
    }
    await db.query("UPDATE jobs SET charge = '{}'::jsonb WHERE id = $1", [jobId]);
  };
}

/**
 * Registre des jobs complété par l'envoi d'e-mails. À passer au worker
 * (server.ts) : `new WorkerJobs(db, { mailer, registre: registreAvecEmails(mailer, trousseau) })`.
 */
export function registreAvecEmails(
  mailer: Mailer,
  trousseau: Trousseau,
  base: RegistreJobs = REGISTRE_JOBS,
): RegistreJobs {
  return creerRegistre({
    ...Object.fromEntries(base),
    [TYPE_JOB_EMAIL]: creerHandlerEmail(mailer, trousseau),
    // Relances de factures : l'e-mail au client passe par la file chiffrée.
    ...(base.has(TYPE_JOB_RELANCES)
      ? {
          [TYPE_JOB_RELANCES]: creerHandlerRelances((db, cabinetId, message) =>
            differerEmail(db, trousseau, cabinetId, message, 0),
          ),
        }
      : {}),
  });
}
