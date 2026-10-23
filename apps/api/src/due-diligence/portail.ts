import {
  PLAFONDS_DD_PORTAIL,
  type DdPortailCompte,
  type DdPortailOption,
  type ddPortailPublicationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { exigerMissionVisible, type MissionAcces } from "../missions/acces.js";
import { lireDossier, verrouillerCabinet, type DossierLu } from "./acces.js";
import type { NoteLue } from "./notes.js";

/*
 * Portail investisseur de la due diligence, côté CABINET (migration 0509) : option du cabinet,
 * invitations d'un compte du portail sur un dossier, publication d'une version VALIDÉE de note
 * (instantané copié PAR LE SERVEUR, jamais reçu) avec les rapports choisis, retraits, état du
 * partage. Règles (les routes vérifient la permission AVANT tout accès aux données) :
 * - toute action sur un dossier exige la visibilité de sa mission (404 sinon, même libellé que
 *   l'inexistant) et verrouille la mission (écritures sérialisées) ;
 * - inviter et publier exigent une mission NON clôturée (409 MISSION_CLOTUREE, route) ; retirer une
 *   invitation ou une publication reste possible après la clôture : réduire l'exposition ne doit
 *   jamais être bloqué (choix prudent, signalé) ;
 * - chaque contrôle est doublé en base (MQD01 à MQD08) ; les messages ne recopient aucune valeur.
 */

export type CorpsPublication = z.infer<typeof ddPortailPublicationSchema>;

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

/* ----- Option du cabinet ----- */

export async function lireOption(db: Db, cabinetId: string): Promise<DdPortailOption> {
  const r = await db.query(
    `SELECT o.actif, o.cree_le FROM dd_portail_options o
     WHERE o.cabinet_id = $1 ORDER BY o.numero DESC LIMIT 1`,
    [cabinetId],
  );
  const l = r.rows[0] as { actif: boolean; cree_le: Date } | undefined;
  return { actif: l?.actif === true, modifie_le: iso(l?.cree_le ?? null) };
}

/** Change l'option ; renvoie `change: false` (rien d'inscrit) si elle est déjà dans cet état. */
export async function changerOption(
  db: Db,
  auth: Auth,
  actif: boolean,
): Promise<{ option: DdPortailOption; change: boolean }> {
  await verrouillerCabinet(db, auth.cabinetId, "portail_option");
  const courante = await lireOption(db, auth.cabinetId);
  if (courante.actif === actif) return { option: courante, change: false };
  const n = await db.query(
    "SELECT count(*)::int AS n FROM dd_portail_options WHERE cabinet_id = $1",
    [auth.cabinetId],
  );
  if ((n.rows[0].n as number) >= PLAFONDS_DD_PORTAIL.changements_option) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      `Plafond atteint : ${PLAFONDS_DD_PORTAIL.changements_option} changements de l'option au plus.`,
    );
  }
  const r = await db.query(
    `INSERT INTO dd_portail_options (cabinet_id, actif, modifie_par) VALUES ($1, $2, $3)
     RETURNING cree_le`,
    [auth.cabinetId, actif, auth.utilisateurId],
  );
  return { option: { actif, modifie_le: iso(r.rows[0].cree_le as Date) }, change: true };
}

/* ----- Accès au dossier ----- */

/**
 * Dossier d'une mission visible, mission VERROUILLÉE (sans condition de clôture : réservé aux
 * retraits) ; 404 au même libellé (`quoi`) qu'un dossier inexistant ou d'une mission invisible.
 */
export async function dossierVerrouille(
  db: Db,
  auth: Auth,
  id: string,
  quoi = "Dossier",
): Promise<{ dossier: DossierLu; mission: MissionAcces }> {
  const dossier = await lireDossier(db, id);
  if (!dossier) throw introuvable(quoi);
  try {
    return { dossier, mission: await exigerMissionVisible(db, auth, dossier.mission_id, true) };
  } catch (e) {
    throw e instanceof AppError && e.statut === 404 ? introuvable(quoi) : e;
  }
}

/* ----- Comptes et invitations ----- */

const ADMISSIBLE = `(up.client_id = $2 AND up.statut = 'actif' AND u.actif
  AND 'client_investisseur' = ANY (u.roles))`;

/**
 * Comptes d'un dossier : investisseurs actifs du client du dossier, plus les comptes encore invités
 * qui ne sont plus admissibles (à retirer). Nom seulement : ni e-mail, ni rôle, ni téléphone.
 */
export async function comptesDuDossier(db: Db, dossier: DossierLu): Promise<DdPortailCompte[]> {
  const r = await db.query(
    `WITH courantes AS (
       SELECT DISTINCT ON (i.utilisateur_id) i.utilisateur_id, i.action, i.cree_le
       FROM dd_portail_invites i WHERE i.dossier_id = $1
       ORDER BY i.utilisateur_id, i.numero DESC)
     SELECT u.id AS utilisateur_id, u.nom, ${ADMISSIBLE} AS admissible,
       coalesce(c.action = 'invite', false) AS invite,
       CASE WHEN c.action = 'invite' THEN c.cree_le END AS invite_le
     FROM utilisateurs_portail up
       JOIN utilisateurs u ON u.id = up.utilisateur_id
       LEFT JOIN courantes c ON c.utilisateur_id = up.utilisateur_id
     WHERE ${ADMISSIBLE} OR c.action = 'invite'
     ORDER BY lower(u.nom), u.id LIMIT $3`,
    [dossier.id, dossier.client_id, PLAFONDS_DD_PORTAIL.comptes_par_dossier],
  );
  return r.rows.map((l) => ({
    utilisateur_id: l.utilisateur_id as string,
    nom: l.nom as string,
    admissible: l.admissible === true,
    invite: l.invite === true,
    invite_le: iso((l.invite_le as Date | null) ?? null),
  }));
}

async function invitationActive(db: Db, dossierId: string, utilisateurId: string) {
  const r = await db.query("SELECT dd_portail_invitation_active($1, $2) AS active", [
    dossierId,
    utilisateurId,
  ]);
  return r.rows[0]?.active === true;
}

export async function inviterCompte(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  utilisateurId: string,
): Promise<{ utilisateur_id: string; invite_le: string }> {
  const admissible = await db.query(
    `SELECT 1 FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
     WHERE up.utilisateur_id = $1 AND ${ADMISSIBLE}`,
    [utilisateurId, dossier.client_id],
  );
  if (!admissible.rows[0]) {
    throw new AppError(
      400,
      "DD_PORTAIL_COMPTE_NON_ADMISSIBLE",
      "Seul un investisseur actif du portail, rattaché au client du dossier, est invitable.",
    );
  }
  if (await invitationActive(db, dossier.id, utilisateurId)) {
    throw new AppError(409, "DD_PORTAIL_DEJA_INVITE", "Ce compte est déjà invité sur ce dossier.");
  }
  await exigerPlafondEvenements(db, dossier.id);
  const r = await db.query(
    `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
     VALUES ($1, $2, $3, 'invite', $4) RETURNING cree_le`,
    [auth.cabinetId, dossier.id, utilisateurId, auth.utilisateurId],
  );
  return { utilisateur_id: utilisateurId, invite_le: iso(r.rows[0].cree_le as Date) as string };
}

/** Retrait d'une invitation active (404 « Invitation » si le compte n'est pas invité). */
export async function retirerInvitation(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  utilisateurId: string,
): Promise<void> {
  if (!(await invitationActive(db, dossier.id, utilisateurId))) throw introuvable("Invitation");
  await exigerPlafondEvenements(db, dossier.id);
  await db.query(
    `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
     VALUES ($1, $2, $3, 'retire', $4)`,
    [auth.cabinetId, dossier.id, utilisateurId, auth.utilisateurId],
  );
}

async function exigerPlafondEvenements(db: Db, dossierId: string): Promise<void> {
  const r = await db.query(
    "SELECT count(*)::int AS n FROM dd_portail_invites WHERE dossier_id = $1",
    [dossierId],
  );
  const max = PLAFONDS_DD_PORTAIL.evenements_invitation_par_dossier;
  if ((r.rows[0].n as number) >= max) {
    throw new AppError(409, "PLAFOND_ATTEINT", `Plafond atteint : ${max} invitations au plus.`);
  }
}

/* ----- Publications ----- */

const PUBLICATION_ACTIVE_SQL = `SELECT p.id FROM dd_portail_publications p
  WHERE p.note_id = $1 AND NOT EXISTS (
    SELECT 1 FROM dd_portail_publication_retraits r WHERE r.publication_id = p.id)
  ORDER BY p.numero DESC LIMIT 1`;

/**
 * Publie la version `version` d'une note : la DERNIÈRE soumise et VALIDÉE (409 NOTE_NON_VALIDEE ou
 * NOTE_PERIMEE sinon), sans autre publication active de la note (409), avec des rapports
 * `note_comite` validés de CETTE version dont le fichier existe encore (400 sinon). L'instantané
 * est copié de la base par un INSERT … SELECT : aucun contenu reçu du client.
 */
export async function publierNote(
  db: Db,
  auth: Auth,
  note: NoteLue,
  corps: CorpsPublication,
): Promise<{ id: string; pieces: number }> {
  const derniere = await db.query(
    `SELECT v.version, x.decision FROM dd_note_versions v
       LEFT JOIN dd_note_validations x ON x.note_version_id = v.id
     WHERE v.note_id = $1 AND v.etat = 'soumise' ORDER BY v.version DESC LIMIT 1`,
    [note.id],
  );
  const l = derniere.rows[0] as { version: number; decision: string | null } | undefined;
  if (l && l.version > corps.version) {
    throw new AppError(
      409,
      "NOTE_PERIMEE",
      "Cette version n'est plus la dernière version soumise de la note.",
    );
  }
  if (!l || l.version !== corps.version || l.decision !== "valide") {
    throw new AppError(
      409,
      "NOTE_NON_VALIDEE",
      "Seule la dernière version soumise et validée de la note se publie.",
    );
  }
  if ((await db.query(PUBLICATION_ACTIVE_SQL, [note.id])).rows[0]) {
    throw new AppError(
      409,
      "DD_PORTAIL_PUBLICATION_ACTIVE",
      "Une publication de cette note est déjà active : retirez-la avant d'en publier une autre.",
    );
  }
  const rapports = await db.query(
    `SELECT r.id, r.variante, r.format FROM rapports_mission r
     WHERE r.id = ANY ($1::uuid[]) AND r.modele = 'note_comite' AND r.statut = 'valide'
       AND r.dd_note_id = $2 AND r.version_source = $3 AND r.format IN ('pdf', 'docx')
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = r.fichier_id)`,
    [corps.rapports, note.id, corps.version],
  );
  if (rapports.rows.length !== corps.rapports.length) {
    throw new AppError(
      400,
      "DD_PORTAIL_PIECE_NON_ADMISSIBLE",
      "Chaque pièce est un rapport validé de la version publiée de la note, encore disponible.",
    );
  }
  const n = await db.query(
    "SELECT count(*)::int AS n FROM dd_portail_publications WHERE note_id = $1",
    [note.id],
  );
  const max = PLAFONDS_DD_PORTAIL.publications_par_note;
  if ((n.rows[0].n as number) >= max) {
    throw new AppError(409, "PLAFOND_ATTEINT", `Plafond atteint : ${max} publications au plus.`);
  }
  const p = await db.query(
    `INSERT INTO dd_portail_publications (cabinet_id, dossier_id, client_id, note_id,
       note_version_id, version, titre, recommandation, synthese, conditions, valide_le, publie_par)
     SELECT n.cabinet_id, n.dossier_id, d.client_id, n.id, v.id, v.version, n.titre,
       v.recommandation, v.synthese, v.conditions, x.valide_le, $3
     FROM dd_note_versions v
       JOIN dd_notes n ON n.id = v.note_id
       JOIN dd_dossiers d ON d.id = n.dossier_id
       JOIN dd_note_validations x ON x.note_version_id = v.id AND x.decision = 'valide'
     WHERE v.note_id = $1 AND v.version = $2
     RETURNING id, client_id`,
    [note.id, corps.version, auth.utilisateurId],
  );
  const publication = p.rows[0] as { id: string; client_id: string };
  const parId = new Map(
    (rapports.rows as { id: string; variante: string; format: string }[]).map((x) => [x.id, x]),
  );
  for (const rapportId of corps.rapports) {
    const x = parId.get(rapportId) as { variante: string; format: string };
    await db.query(
      `INSERT INTO dd_portail_pieces (cabinet_id, publication_id, rapport_id, client_id, variante,
         format) VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, publication.id, rapportId, publication.client_id, x.variante, x.format],
    );
  }
  return { id: publication.id, pieces: corps.rapports.length };
}

export interface PublicationLue {
  id: string;
  dossier_id: string;
  client_id: string;
  note_id: string;
  retiree: boolean;
}

export async function lirePublication(db: Db, id: string): Promise<PublicationLue | null> {
  const r = await db.query(
    `SELECT p.id, p.dossier_id, p.client_id, p.note_id,
       EXISTS (SELECT 1 FROM dd_portail_publication_retraits r WHERE r.publication_id = p.id)
         AS retiree
     FROM dd_portail_publications p WHERE p.id = $1`,
    [id],
  );
  return (r.rows[0] as PublicationLue | undefined) ?? null;
}

export async function retirerPublication(
  db: Db,
  auth: Auth,
  publication: PublicationLue,
): Promise<void> {
  if (publication.retiree) {
    throw new AppError(
      409,
      "DD_PORTAIL_PUBLICATION_RETIREE",
      "Cette publication est déjà retirée du portail.",
    );
  }
  await db.query(
    `INSERT INTO dd_portail_publication_retraits (cabinet_id, publication_id, client_id, retire_par)
     VALUES ($1, $2, $3, $4)`,
    [auth.cabinetId, publication.id, publication.client_id, auth.utilisateurId],
  );
}
