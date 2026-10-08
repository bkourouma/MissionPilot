import type { Db } from "./db/pool.js";

export interface EntreeAudit {
  cabinetId: string;
  utilisateurId: string | null;
  action: string;
  entite: string;
  entiteId?: string | null;
  details?: Record<string, unknown>;
}

/** À appeler dans la même transaction que l'action journalisée. */
export async function journaliser(db: Db, entree: EntreeAudit): Promise<void> {
  await db.query(
    `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entree.cabinetId,
      entree.utilisateurId,
      entree.action,
      entree.entite,
      entree.entiteId ?? null,
      JSON.stringify(entree.details ?? {}),
    ],
  );
}
