import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Garde « assertion citée » (due diligence, SPEC-3b §8.3, ASSERTION_CITEE). Une assertion citée par
 * un verdict RETENU (en attente ou validé ; jamais rejeté) est la source figée de ce verdict : elle
 * ne s'abandonne pas, ne change pas d'énoncé et ne perd ni ne change le sens d'aucune de ses
 * preuves, sans quoi le verdict deviendrait faux sans que personne ne le revoie. La garde vit ici,
 * dans le module des preuves, pour que les routes génériques du registre (`POST /assertions/:id/
 * versions`, `POST /assertions/:id/liens`, `DELETE /assertions/:id/liens/:preuveId`) et le module
 * de due diligence disent la même règle. Ce fichier ne dépend d'aucun autre module du lot.
 */

/**
 * Verdict RETENU (en attente ou validé ; jamais rejeté) qui cite l'assertion, éventuellement pour
 * une seule hypothèse.
 */
export async function verdictRetenuCitant(
  db: Db,
  assertionId: string,
  hypotheseId: string | null,
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM dd_verdicts v
       LEFT JOIN dd_verdict_validations x ON x.verdict_id = v.id,
       jsonb_array_elements(v.assertions_citees) c
     WHERE c.value ->> 'assertion_id' = $1::text
       AND ($2::uuid IS NULL OR v.hypothese_id = $2::uuid)
       AND (x.id IS NULL OR x.decision = 'valide')
     LIMIT 1`,
    [assertionId, hypotheseId],
  );
  return r.rows.length > 0;
}

export function assertionCitee(): AppError {
  return new AppError(
    409,
    "ASSERTION_CITEE",
    "Cette assertion est citée par un verdict en attente ou validé : elle ne se délie, ne change de sens, ne s'abandonne, ne change d'énoncé ni ne se retire plus.",
  );
}

/** 409 ASSERTION_CITEE si l'assertion est citée par un verdict retenu. */
export async function exigerAssertionNonCitee(db: Db, assertionId: string): Promise<void> {
  if (await verdictRetenuCitant(db, assertionId, null)) throw assertionCitee();
}
