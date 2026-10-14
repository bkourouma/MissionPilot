import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur } from "../http/outils.js";
import { requeteInvalide } from "../errors.js";

/*
 * Journalisation et curseurs des routes de la due diligence. `details` ne porte JAMAIS un énoncé,
 * un motif ni un extrait : seulement des identifiants, des numéros de version et des valeurs
 * d'énumération (SPEC-3b §8.0).
 */

export function journalDd(
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

/** Numéro de la dernière ligne servie, extrait d'un curseur opaque (400 si invalide). */
export function curseurNumero(curseur: string | undefined): string | null {
  const apres = decoderCurseur(curseur);
  if (apres && !/^\d{1,18}$/.test(apres[0])) {
    throw requeteInvalide("Curseur de pagination invalide.");
  }
  return apres?.[0] ?? null;
}
