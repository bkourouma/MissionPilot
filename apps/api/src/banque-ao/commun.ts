import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, encoderCurseur } from "../http/outils.js";
import { requeteInvalide } from "../errors.js";

/*
 * Outils communs du lot AO-B (banques de CV et de références, offres) : journal d'audit dans la
 * transaction, verrou d'une entité versionnée, mois de référence, curseurs.
 */

export function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  id: string,
  details: Record<string, unknown> = {},
) {
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details,
  });
}

/**
 * Sérialise les écritures d'une entité versionnée : ses tables sont en ajout seul (UPDATE
 * révoqué), un `FOR UPDATE` est donc impossible ; verrou consultatif de transaction.
 */
export async function verrouEntite(db: Db, type: string, id: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`ao:${type}:${id}`]);
}

/** Mois courant « AAAA-MM » (UTC) : référence par défaut du calcul des années d'expérience. */
export function moisCourant(maintenant = new Date()): string {
  return maintenant.toISOString().slice(0, 7);
}

/** Curseur sur un numéro d'identité décroissant (listes d'offres et de références). */
export function curseurNumero(curseur: string | undefined): string | null {
  const apres = decoderCurseur(curseur);
  if (apres && !/^\d{1,19}$/.test(apres[0])) {
    throw requeteInvalide("Curseur de pagination invalide.");
  }
  return apres?.[0] ?? null;
}

/** Page lue en LIMIT n+1 sur un numéro décroissant. */
export function pageParNumero<T extends { numero: string | number; id: string }>(
  lignes: T[],
  limite: number,
): { elements: T[]; curseur_suivant: string | null } {
  const page = lignes.slice(0, limite);
  const derniere = page[page.length - 1];
  return {
    elements: page,
    curseur_suivant:
      lignes.length > limite && derniere
        ? encoderCurseur([String(derniere.numero), derniere.id])
        : null,
  };
}
