import { createHash } from "node:crypto";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";

/*
 * Clé d'idempotence des saisies de temps (migration 0122), en-tête
 * `Idempotency-Key` de `PUT /feuilles-temps/:id/lignes`.
 *
 * Le client hors ligne rejoue ses saisies avec une clé propre à chaque état de
 * la feuille. La première application enregistre la clé (dans la transaction de
 * la saisie : une saisie refusée n'en laisse aucune trace) ; un rejeu de la même
 * clé, pour la même feuille et le même contenu, ne ré-applique RIEN et répond
 * l'état courant de la feuille : un rejeu tardif n'écrase donc pas une saisie
 * plus récente. La clé est propre à l'utilisateur (unicité cabinet + utilisateur
 * + clé). Même clé pour une autre feuille ou un autre contenu : 409.
 * Sans l'en-tête, le comportement est inchangé (PUT complet).
 */

export const ENTETE_IDEMPOTENCE = "idempotency-key";
const FORMAT_CLE = /^[A-Za-z0-9_-]{8,100}$/;
const CONSERVATION_CLES_JOURS = 30;

/** Clé de l'en-tête, ou `undefined` s'il est absent ; 400 si le format est invalide. */
export function cleIdempotence(entete: string | string[] | undefined): string | undefined {
  if (entete === undefined) return undefined;
  if (Array.isArray(entete) || !FORMAT_CLE.test(entete)) {
    throw requeteInvalide(
      "En-tête Idempotency-Key invalide (8 à 100 caractères : A-Z a-z 0-9 _ -).",
    );
  }
  return entete;
}

/** Empreinte du contenu d'une saisie (ordre des champs fixé par le schéma Zod). */
export function empreinteSaisie(contenu: unknown): string {
  return createHash("sha256").update(JSON.stringify(contenu)).digest("hex");
}

/**
 * Réserve la clé pour cette saisie. Vrai : première application, la saisie
 * s'exécute. Faux : déjà appliquée, la saisie est un rejeu à ne pas refaire.
 * Une requête simultanée de même clé attend la fin de la première (index unique).
 */
export async function reserverCleSaisie(
  db: Db,
  auth: Auth,
  cle: string,
  feuilleId: string,
  empreinte: string,
): Promise<boolean> {
  await db.query(
    `DELETE FROM saisies_idempotence
     WHERE utilisateur_id = $1 AND cree_le < now() - make_interval(days => $2::int)`,
    [auth.utilisateurId, CONSERVATION_CLES_JOURS],
  );
  const r = await db.query(
    `INSERT INTO saisies_idempotence (cabinet_id, utilisateur_id, cle, feuille_id, empreinte)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cabinet_id, utilisateur_id, cle) DO NOTHING`,
    [auth.cabinetId, auth.utilisateurId, cle, feuilleId, empreinte],
  );
  if (r.rowCount === 1) return true;
  const existante = await db.query(
    `SELECT feuille_id, empreinte FROM saisies_idempotence
     WHERE utilisateur_id = $1 AND cle = $2`,
    [auth.utilisateurId, cle],
  );
  const e = existante.rows[0];
  if (!e || e.feuille_id !== feuilleId || e.empreinte !== empreinte) {
    throw new AppError(
      409,
      "CLE_IDEMPOTENCE_REUTILISEE",
      "Cette clé d'idempotence a déjà servi pour une autre saisie.",
    );
  }
  return false;
}
