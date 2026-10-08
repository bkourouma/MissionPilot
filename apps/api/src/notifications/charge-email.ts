import { z } from "zod";
import { chiffrer, type Trousseau } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import type { MessageEmail } from "./mailer.js";

/*
 * Mise en file chiffrée d'un e-mail (job « envoyer_email », ADR-002), sans
 * dépendance vers le registre des jobs : notifier.ts et les handlers de jobs
 * l'importent sans créer d'importation circulaire (voir file-email.ts pour le
 * handler d'envoi et la reprise).
 */

export const TYPE_JOB_EMAIL = "envoyer_email";
export const TENTATIVES_EMAIL = 5;

export const messageSchema = z.object({
  a: z.string().min(3).max(254),
  sujet: z.string().max(500),
  texte: z.string().max(20_000),
});

export const chargeSchema = z.object({ v: z.number().int().positive(), d: z.string().min(1) });

export const aad = (cabinetId: string) => `file_email:${cabinetId}`;

/** Met un e-mail en file, dans la transaction courante (contexte RLS du cabinet). */
export async function differerEmail(
  db: Db,
  trousseau: Trousseau,
  cabinetId: string,
  message: MessageEmail,
  delaiMs = 60_000,
): Promise<string> {
  const c = chiffrer(
    trousseau,
    "file_email",
    Buffer.from(JSON.stringify(messageSchema.parse(message)), "utf8"),
    aad(cabinetId),
  );
  const r = await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, tentatives_max, execute_a)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval) RETURNING id`,
    [
      cabinetId,
      TYPE_JOB_EMAIL,
      JSON.stringify({ v: c.version, d: c.donnees.toString("base64") }),
      TENTATIVES_EMAIL,
      String(delaiMs),
    ],
  );
  return r.rows[0].id as string;
}
