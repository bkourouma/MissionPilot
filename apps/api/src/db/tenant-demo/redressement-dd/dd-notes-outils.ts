import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, midi } from "./commun.js";

/*
 * Outils des notes au comité et du portail investisseur de la due diligence (Tenant démo) :
 * antidatage par requêtes LITTÉRALES (noms de table écrits en dur, jamais interpolés) des lignes
 * en ajout seul que les routes horodatent « maintenant ».
 *
 * Ce qui est remonté, et seulement cela : `cree_le` (notes, versions, option, invitations,
 * publications, pièces, retraits), `soumise_le` (calé sur le `cree_le` de la version soumise, la
 * contrainte 0507 exigeant les deux ensemble), `valide_le` (validations) et `genere_le`
 * (rapports). Ordres respectés par le séquencement des appels : une version n+1 n'est jamais
 * antérieure à la version n, une validation suit sa soumission, une publication suit la validation
 * dont elle copie `valide_le` (la copie est faite à l'insertion, donc la validation est datée
 * AVANT de publier), une pièce suit sa publication, un retrait suit sa publication.
 */

export async function dateNote(ctx: ContexteTenantDemo, noteId: string, jour: string) {
  await appliquerSql(ctx, "UPDATE dd_notes SET cree_le = $1::timestamptz WHERE id = $2", [
    midi(jour),
    noteId,
  ]);
}

/** Version d'une note (brouillon ou soumise : `soumise_le` suit le `cree_le`). */
export async function dateVersionNote(
  ctx: ContexteTenantDemo,
  noteId: string,
  version: number,
  jour: string,
) {
  await appliquerSql(
    ctx,
    `UPDATE dd_note_versions
        SET cree_le = $1::timestamptz,
            soumise_le = CASE WHEN soumise_le IS NULL THEN NULL ELSE $1::timestamptz END
      WHERE note_id = $2 AND version = $3`,
    [midi(jour), noteId, version],
  );
}

export async function dateValidationNote(
  ctx: ContexteTenantDemo,
  noteId: string,
  version: number,
  jour: string,
) {
  await appliquerSql(
    ctx,
    `UPDATE dd_note_validations SET valide_le = $1::timestamptz
      WHERE note_version_id IN (SELECT id FROM dd_note_versions WHERE note_id = $2 AND version = $3)`,
    [midi(jour), noteId, version],
  );
}

export async function dateRapportNote(ctx: ContexteTenantDemo, rapportId: string, jour: string) {
  await appliquerSql(ctx, "UPDATE rapports_mission SET genere_le = $1::timestamptz WHERE id = $2", [
    midi(jour),
    rapportId,
  ]);
}

/** Dernier changement de l'option du portail (le plus grand numéro du cabinet). */
export async function dateOptionPortail(ctx: ContexteTenantDemo, jour: string) {
  await appliquerSql(
    ctx,
    `UPDATE dd_portail_options SET cree_le = $1::timestamptz
      WHERE cabinet_id = $2
        AND numero = (SELECT max(numero) FROM dd_portail_options WHERE cabinet_id = $2)`,
    [midi(jour), ctx.cabinetId],
  );
}

/** Dernier événement d'invitation d'un compte sur un dossier. */
export async function dateInvitation(
  ctx: ContexteTenantDemo,
  dossierId: string,
  utilisateurId: string,
  jour: string,
) {
  await appliquerSql(
    ctx,
    `UPDATE dd_portail_invites SET cree_le = $1::timestamptz
      WHERE dossier_id = $2 AND utilisateur_id = $3
        AND numero = (SELECT max(numero) FROM dd_portail_invites
                       WHERE dossier_id = $2 AND utilisateur_id = $3)`,
    [midi(jour), dossierId, utilisateurId],
  );
}

/** Publication et ses pièces. */
export async function datePublication(
  ctx: ContexteTenantDemo,
  publicationId: string,
  jour: string,
) {
  const t = midi(jour);
  await appliquerSql(
    ctx,
    "UPDATE dd_portail_publications SET cree_le = $1::timestamptz WHERE id = $2",
    [t, publicationId],
  );
  await appliquerSql(
    ctx,
    "UPDATE dd_portail_pieces SET cree_le = $1::timestamptz WHERE publication_id = $2",
    [t, publicationId],
  );
}

export async function dateRetrait(ctx: ContexteTenantDemo, publicationId: string, jour: string) {
  await appliquerSql(
    ctx,
    "UPDATE dd_portail_publication_retraits SET cree_le = $1::timestamptz WHERE publication_id = $2",
    [midi(jour), publicationId],
  );
}
