import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";

/*
 * Journal d'audit du redressement (SPEC-3a §9.6), dans la transaction de l'écriture. Les détails
 * ne portent que des IDENTIFIANTS, des COMPTES et des CODES : jamais un montant, un nom de
 * créancier, une condition de négociation, un titre d'action, un commentaire ni un motif.
 */
export function journalRed(
  db: Db,
  auth: Auth,
  entite: string,
  action: string,
  id: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details,
  });
}
