import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { tropDeRequetes } from "./erreurs.js";

/*
 * Plafonds de débit des actes sensibles du lot canaux (SPEC-3c §13) : comptés EN BASE (jamais en
 * mémoire), sur `journal_audit`, sous verrou consultatif et dans la transaction qui inscrit l'acte
 * (modèles `copilote/limites.ts`, `routes/factures-pdf.ts`). Valeurs de départ PROVISOIRES (O-16).
 */

export const PLAFONDS_DEBIT = {
  /** Aperçu de la synthèse du dirigeant : 30 par 10 minutes et par utilisateur. */
  apercu_synthese: { action: "canal.synthese.apercu", max: 30, minutes: 10 },
  /** Simulateur (message entrant simulé) : 60 par 10 minutes et par utilisateur. */
  simulateur: { action: "canal.simulateur.entrant", max: 60, minutes: 10 },
  /** Demandes de signature : 30 créations par 10 minutes et par utilisateur. */
  signature: { action: "signature.demander", max: 30, minutes: 10 },
  /** Transcriptions : 20 créations par 10 minutes et par utilisateur. */
  transcription: { action: "transcription.creer", max: 20, minutes: 10 },
  /** Corrections du texte d'une transcription : 30 par 10 minutes et par utilisateur. */
  correction_transcription: { action: "transcription.modifier", max: 30, minutes: 10 },
} as const;

export type PlafondDebit = keyof typeof PLAFONDS_DEBIT;

/**
 * Vérifie le plafond de l'utilisateur pour cette action (429 `TROP_DE_REQUETES` sinon) sous un
 * verrou propre à l'utilisateur et à l'action. L'appelant journalise l'acte (même action) dans la
 * MÊME transaction : le compte vient de ces lignes ; deux requêtes simultanées ne dépassent pas la
 * limite.
 */
export async function verifierDebit(db: Db, auth: Auth, plafond: PlafondDebit): Promise<void> {
  const p = PLAFONDS_DEBIT[plafond];
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_debit_util:${p.action}:${auth.utilisateurId}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, p.action, p.minutes],
  );
  if ((r.rows[0].n as number) >= p.max) {
    throw tropDeRequetes(
      `Cette action est limitée à ${p.max} demandes par ${p.minutes} minutes : réessayez plus tard.`,
    );
  }
}
